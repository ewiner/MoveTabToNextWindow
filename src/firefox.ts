import { TabMover, NEW_WINDOW } from "./tabMover";

const tabMover = new TabMover();

const NEXT_WINDOW_MENU_ID = "move-tab-to-next-window";
const PARENT_MENU_ID = "move-tab-to-window";
const NEW_WINDOW_MENU_ID = "move-tab-to-new-window";
const SEPARATOR_MENU_ID = "move-tab-to-window-separator";
const WINDOW_MENU_ID_PREFIX = "move-tab-to-window:";

// (Re)build the tab context menu. The window submenu is rebuilt just before the
// menu is shown so it always reflects the currently open windows. `excludeWindowId`
// omits the window the right-clicked tab already lives in.
const buildMenu = async (excludeWindowId?: number) => {
  await browser.menus.removeAll();

  browser.menus.create({
    id: NEXT_WINDOW_MENU_ID,
    contexts: ["tab"],
    title: "Move to the next window",
  });
  browser.menus.create({
    id: PARENT_MENU_ID,
    contexts: ["tab"],
    title: "Move tab to window",
  });
  browser.menus.create({
    id: NEW_WINDOW_MENU_ID,
    parentId: PARENT_MENU_ID,
    contexts: ["tab"],
    title: "New window",
  });

  const options = await tabMover.getWindowMenuOptions(excludeWindowId);
  if (options.length > 0) {
    browser.menus.create({
      id: SEPARATOR_MENU_ID,
      parentId: PARENT_MENU_ID,
      contexts: ["tab"],
      type: "separator",
    });
    for (const option of options) {
      browser.menus.create({
        id: `${WINDOW_MENU_ID_PREFIX}${option.id}`,
        parentId: PARENT_MENU_ID,
        contexts: ["tab"],
        title: option.label,
      });
    }
  }
};

void buildMenu();

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts.includes("tab")) {
    return;
  }
  await buildMenu(tab?.windowId);
  browser.menus.refresh();
});

browser.menus.onClicked.addListener((info, tab) => {
  if (tab == null) {
    return;
  }
  if (info.menuItemId === NEXT_WINDOW_MENU_ID) {
    void tabMover.moveTabOrHighlightedTabs(tab);
  } else if (info.menuItemId === NEW_WINDOW_MENU_ID) {
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

browser.browserAction.onClicked.addListener((tab) => tabMover.moveTabOrHighlightedTabs(tab));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
browser.commands.onCommand.addListener((_, tab) => tabMover.moveTabOrHighlightedTabs(tab));
