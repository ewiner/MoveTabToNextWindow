import { TabMover } from "./tabMover";

const tabMover = new TabMover();

const HEADING_MENU_ID = "move-to-window-heading";
const WINDOW_MENU_ID_PREFIX = "move-to-window:";

// (Re)build the tab context menu: a flat, directly-clickable, numbered list of
// the other open windows (labelled after their first tab) under a heading.
// Rebuilt just before the menu is shown so it always reflects the currently
// open windows. `excludeWindowId` omits the window the right-clicked tab already
// lives in. Moving to the *next* window remains the toolbar / shortcut action.
const buildMenu = async (excludeWindowId?: number) => {
  await browser.menus.removeAll();

  const options = await tabMover.getWindowMenuOptions(excludeWindowId);
  if (options.length > 0) {
    browser.menus.create({
      id: HEADING_MENU_ID,
      contexts: ["tab"],
      title: "Move to window:",
      enabled: false,
    });
    options.forEach((option, index) => {
      browser.menus.create({
        id: `${WINDOW_MENU_ID_PREFIX}${option.id}`,
        contexts: ["tab"],
        title: `${index + 1}. ${option.label}`,
      });
    });
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
  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith(WINDOW_MENU_ID_PREFIX)) {
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
