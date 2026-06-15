/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-empty-function */
import { browser } from "webextension-polyfill-ts";

export interface Tab {
  id?: number;
  windowId?: number;
  groupId?: number;
  index: number;
  active: boolean;
}

export interface Data {
  [key: string]: Tab;
}

/**
 * Sentinel passed as a target to force the tab(s) into a brand new window,
 * regardless of how many windows are currently open.
 */
export const NEW_WINDOW = -1;

export interface WindowMenuOption {
  /** The id of the window the tab(s) should be moved into. */
  id: number;
  /** A human-friendly label derived from the window's active tab. */
  label: string;
}

export class TabMover {
  private originalTabInfoByTabWindowId: Data = {};

  private tabWindowId(tabId: number, windowId: number): string {
    return `${tabId}:${windowId}`;
  }

  constructor(
    private loadData?: () => Promise<Data>,
    private saveData: (data: Data) => Promise<void> = async () => {},
    private tabMoveWrapper: (
      tab: Tab,
      moveOperation: () => Promise<number>
    ) => Promise<void> = async (_, moveOperation) => {
      await moveOperation();
    }
  ) {}

  /**
   * Build the list of windows to offer in a "move to window" menu.
   *
   * Chrome/Firefox don't expose a user-assigned window name to extensions, so
   * each window is labelled after its active tab (mirroring the browser's own
   * native "Move tab to another window" menu), suffixed with the tab count.
   *
   * @param excludeWindowId optionally omit a window (typically the focused one
   *   the tab being acted on already lives in).
   */
  async getWindowMenuOptions(excludeWindowId?: number): Promise<WindowMenuOption[]> {
    const windows = await browser.windows.getAll({ populate: true });
    const options: WindowMenuOption[] = [];
    for (const window of windows) {
      if (window.id == null || window.type !== "normal") {
        continue;
      }
      if (excludeWindowId != null && window.id === excludeWindowId) {
        continue;
      }
      options.push({ id: window.id, label: this.windowLabel(window.tabs) });
    }
    return options;
  }

  private windowLabel(tabs?: { active?: boolean; title?: string }[]): string {
    const windowTabs = tabs ?? [];
    const activeTab = windowTabs.find((windowTab) => windowTab.active) ?? windowTabs[0];
    const rawTitle = activeTab?.title?.trim();
    const title = rawTitle != null && rawTitle.length > 0 ? rawTitle : "Window";
    const truncated = title.length > 50 ? `${title.slice(0, 49)}…` : title;
    const suffix = windowTabs.length > 1 ? ` (${windowTabs.length} tabs)` : "";
    return `${truncated}${suffix}`;
  }

  async moveTabOrHighlightedTabs(tab: Tab, targetWindowId?: number) {
    const highlightedTabs = await browser.tabs.query({
      highlighted: true,
      currentWindow: true,
    });
    const tabsToMove = highlightedTabs.length > 1 ? highlightedTabs : [tab];
    // Resolve the target once so that multiple selected tabs all land in the
    // same window - especially important when "New window" is chosen, where the
    // first move creates the window and the rest move into the created window.
    let resolvedTargetWindowId = targetWindowId;
    for (const tabToMove of tabsToMove) {
      resolvedTargetWindowId = await this.moveTab(tabToMove, resolvedTargetWindowId);
    }
  }

  async moveActiveTab() {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tabs[0] != null) {
      await this.moveTab(tabs[0]);
    }
  }

  /**
   * Move a single tab.
   *
   * @param requestedTargetWindowId when omitted, the tab is moved to the next
   *   window (the original behaviour). When set to {@link NEW_WINDOW}, it is
   *   moved into a brand new window. Otherwise it is moved into the window with
   *   the given id.
   * @returns the id of the window the tab ended up in, or `undefined` if the
   *   move was skipped.
   */
  private async moveTab(
    tab: Tab,
    requestedTargetWindowId?: number
  ): Promise<number | undefined> {
    if (tab.id == null || tab.windowId == null) {
      return undefined;
    }

    if (this.loadData != null) {
      this.originalTabInfoByTabWindowId = await this.loadData();
    }

    const originalTabWindowId = this.tabWindowId(tab.id, tab.windowId);
    this.originalTabInfoByTabWindowId[originalTabWindowId] = { ...tab };

    const allWindows = (await browser.windows.getAll()).filter(
      (window) => window.id != null && window.type === "normal"
    );

    let targetWindowId: number | undefined;
    const forceNewWindow = requestedTargetWindowId === NEW_WINDOW;
    if (forceNewWindow) {
      targetWindowId = undefined;
    } else if (requestedTargetWindowId != null) {
      targetWindowId = requestedTargetWindowId;
    } else {
      const currentTabWindowIndex = allWindows.findIndex((window) => window.id === tab.windowId);
      targetWindowId = allWindows[(currentTabWindowIndex + 1) % allWindows.length]?.id;
    }

    // Nothing to do if the tab is already in the requested window.
    if (!forceNewWindow && targetWindowId === tab.windowId) {
      return targetWindowId;
    }

    if (forceNewWindow || allWindows.length <= 1 || targetWindowId == null) {
      let newWindowId: number | undefined;
      await this.tabMoveWrapper(tab, async () => {
        const targetWindow = await browser.windows.create({ tabId: tab.id });
        // forcing as windows are always created with an id.
        newWindowId = targetWindow.id as number;
        return newWindowId;
      });
      await this.complete();
      return newWindowId;
    }

    const wasOriginalTabActive = tab.active;
    const targetTabWindowId = this.tabWindowId(tab.id, targetWindowId);
    const targetIndex = this.originalTabInfoByTabWindowId[targetTabWindowId]?.index ?? -1;

    // typescript is losing results of null checks above for no reason, forcing them.
    await this.tabMoveWrapper(tab, async () => {
      await browser.tabs.move(tab.id as number, {
        windowId: targetWindowId,
        index: targetIndex,
      });
      return targetWindowId as number;
    });

    if (wasOriginalTabActive) {
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(targetWindowId, { focused: true });
    }

    await this.complete();
    return targetWindowId;
  }

  private async complete() {
    await this.saveData(this.originalTabInfoByTabWindowId);
  }
}
