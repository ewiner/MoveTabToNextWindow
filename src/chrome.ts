import { TabMover, Tab, Data, NEW_WINDOW } from "./tabMover";

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

// "Move tab to window" context menu with a submenu of the other open windows
// (labelled after their active tab) plus a "New window" entry. It acts on the
// active tab of the window where the menu was invoked.
const PARENT_MENU_ID = "move-tab-to-window";
const NEW_WINDOW_MENU_ID = "move-tab-to-new-window";
const SEPARATOR_MENU_ID = "move-tab-to-window-separator";
const WINDOW_MENU_ID_PREFIX = "move-tab-to-window:";

// Chrome (unlike Firefox) does NOT allow extensions to add items to the tab
// strip's right-click menu - there is no "tab" context. The closest available
// surfaces are the page right-click menu and the extension's toolbar icon.
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
    id: PARENT_MENU_ID,
    title: "Move tab to window",
    contexts: MENU_CONTEXTS,
  });
  chrome.contextMenus.create({
    id: NEW_WINDOW_MENU_ID,
    parentId: PARENT_MENU_ID,
    title: "New window",
    contexts: MENU_CONTEXTS,
  });
  if (options.length > 0) {
    chrome.contextMenus.create({
      id: SEPARATOR_MENU_ID,
      parentId: PARENT_MENU_ID,
      type: "separator",
      contexts: MENU_CONTEXTS,
    });
    for (const option of options) {
      chrome.contextMenus.create({
        id: `${WINDOW_MENU_ID_PREFIX}${option.id}`,
        parentId: PARENT_MENU_ID,
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
  if (info.menuItemId === NEW_WINDOW_MENU_ID) {
    void tabMover.moveTabOrHighlightedTabs(tab, NEW_WINDOW);
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
