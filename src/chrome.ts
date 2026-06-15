import { TabMover, Tab, Data } from "./tabMover";

// chrome-specific hooks
const loadData = (): Promise<Data> => {
  return new Promise((resolve) => chrome.storage.local.get((items) => resolve(items)));
};
const saveData = (data: Data): Promise<void> => {
  return new Promise((resolve) => chrome.storage.local.set(data, () => resolve()));
};
const tabMoveWrapper = async (tab: Tab, moveOperation: () => Promise<number>) => {
  if (tab.groupId == null || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    await moveOperation();
    return;
  }

  const group = await chrome.tabGroups.get(tab.groupId);
  const { color, title } = group;

  const targetWindowId = await moveOperation();

  const existingTargetGroup = (
    await chrome.tabGroups.query({
      color: color,
      title: title,
      windowId: targetWindowId,
    })
  )[0];

  if (existingTargetGroup != null) {
    await chrome.tabs.group({
      groupId: existingTargetGroup.id,
      tabIds: tab.id,
    });
  } else {
    const newGroupId = await chrome.tabs.group({
      createProperties: { windowId: targetWindowId },
      tabIds: tab.id,
    });
    await chrome.tabGroups.update(newGroupId, {
      color: color,
      title: title,
    });
  }
};

// register
const tabMover = new TabMover(loadData, saveData, tabMoveWrapper);

// Context menu: "Move to the next window" plus a flat, directly-clickable list
// of the other open windows (labelled after their first tab) under a heading.
// It acts on the active tab of the window where the menu was invoked.
const NEXT_WINDOW_MENU_ID = "move-to-next-window";
const SEPARATOR_MENU_ID = "move-to-window-separator";
const HEADING_MENU_ID = "move-to-window-heading";
const WINDOW_MENU_ID_PREFIX = "move-to-window:";

// Chrome (unlike Firefox) does NOT allow extensions to add items to the tab
// strip's right-click menu - there is no "tab" context. The closest available
// surfaces are the page right-click menu and the extension's toolbar icon.
// (Chrome collapses multiple top-level items into one submenu named after the
// extension, so the window list lives one level under the extension's name.)
const MENU_CONTEXTS: chrome.contextMenus.ContextType[] = ["page", "action"];

// Chrome has no "on menu shown" event, so the menu is rebuilt whenever windows
// or tab titles change. Rebuilds are debounced to coalesce bursts of events.
let rebuildScheduled = false;
const scheduleMenuRebuild = () => {
  if (rebuildScheduled) {
    return;
  }
  rebuildScheduled = true;
  setTimeout(() => {
    rebuildScheduled = false;
    void rebuildMenu();
  }, 100);
};

const rebuildMenu = async () => {
  await chrome.contextMenus.removeAll();

  // Exclude the focused window - the menu acts on its active tab, and "move to
  // the window I'm already in" is a no-op.
  const focusedWindow = await chrome.windows.getLastFocused().catch(() => undefined);
  const options = await tabMover.getWindowMenuOptions(focusedWindow?.id);

  chrome.contextMenus.create({
    id: NEXT_WINDOW_MENU_ID,
    title: "Move to the next window",
    contexts: MENU_CONTEXTS,
  });
  if (options.length > 0) {
    chrome.contextMenus.create({
      id: SEPARATOR_MENU_ID,
      type: "separator",
      contexts: MENU_CONTEXTS,
    });
    chrome.contextMenus.create({
      id: HEADING_MENU_ID,
      title: "Move to window:",
      enabled: false,
      contexts: MENU_CONTEXTS,
    });
    for (const option of options) {
      chrome.contextMenus.create({
        id: `${WINDOW_MENU_ID_PREFIX}${option.id}`,
        title: option.label,
        contexts: MENU_CONTEXTS,
      });
    }
  }
};

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab == null) {
    return;
  }
  if (info.menuItemId === NEXT_WINDOW_MENU_ID) {
    void tabMover.moveTabOrHighlightedTabs(tab);
  } else if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(WINDOW_MENU_ID_PREFIX)
  ) {
    const targetWindowId = parseInt(info.menuItemId.slice(WINDOW_MENU_ID_PREFIX.length), 10);
    if (!Number.isNaN(targetWindowId)) {
      void tabMover.moveTabOrHighlightedTabs(tab, targetWindowId);
    }
  }
});

// Keep the submenu in sync with the set of windows and their active-tab titles.
chrome.runtime.onInstalled.addListener(() => scheduleMenuRebuild());
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.clear();
  scheduleMenuRebuild();
});
chrome.windows.onCreated.addListener(() => scheduleMenuRebuild());
chrome.windows.onRemoved.addListener(() => scheduleMenuRebuild());
chrome.windows.onFocusChanged.addListener(() => scheduleMenuRebuild());
chrome.tabs.onActivated.addListener(() => scheduleMenuRebuild());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.title != null) {
    scheduleMenuRebuild();
  }
});

chrome.action.onClicked.addListener((tab) => tabMover.moveTabOrHighlightedTabs(tab));
chrome.commands.onCommand.addListener((_, tab) => tabMover.moveTabOrHighlightedTabs(tab));

// Build the menu on service worker startup as well (covers worker restarts).
scheduleMenuRebuild();
