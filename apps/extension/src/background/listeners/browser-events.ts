import type { CapturePolicy } from '../capture-policy.js';
import type { EventCollector } from '../event-collector.js';
import type { ScreenshotEngine } from '../screenshot-engine.js';
import type { VisitTracker } from '../visit-tracker.js';

/**
 * Translates Chrome's browser events into collector drafts.
 *
 * Kept as a function taking its collaborators rather than reaching for module
 * globals, so the mapping from Chrome event to recorded event can be tested
 * without a browser.
 */
export interface BrowserEventDeps {
  collector: EventCollector;
  visits: VisitTracker;
  screenshots: ScreenshotEngine;
  capturePolicy: CapturePolicy;
}

/** Chrome's sentinel for "no window has focus", e.g. the user switched apps. */
const NO_WINDOW = -1;

export function createBrowserEventHandlers({
  collector,
  visits,
  screenshots,
  capturePolicy,
}: BrowserEventDeps) {
  return {
    async onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
      await collector.record({
        type: 'TAB_CREATED',
        url: tab.url,
        title: tab.title,
        tabId: tab.id,
        windowId: tab.windowId,
        metadata: { openerTabId: tab.openerTabId },
      });
    },

    async onTabRemoved(tabId: number, info: chrome.tabs.OnRemovedInfo): Promise<void> {
      const visit = await visits.endVisit(tabId);
      // Chrome reuses tab ids, so a stale rate-limit timestamp would otherwise
      // suppress the first capture in whatever tab inherits this id.
      await capturePolicy.forgetTab(tabId);
      await collector.record({
        type: 'TAB_CLOSED',
        url: visit?.url,
        tabId,
        windowId: info.windowId,
        metadata: {
          windowClosing: info.isWindowClosing,
          ...(visit ? { visitDurationMs: visit.durationMs } : {}),
        },
      });
    },

    async onTabActivated(info: chrome.tabs.OnActivatedInfo): Promise<void> {
      // Every other tab in this window has just lost the foreground; banking
      // their time here is what makes visit durations add up.
      const siblings = await chrome.tabs.query({ windowId: info.windowId });
      await Promise.all(
        siblings
          .filter((tab) => tab.id !== undefined && tab.id !== info.tabId)
          .map((tab) => visits.deactivate(tab.id as number)),
      );
      await visits.activate(info.tabId);

      const tab = await chrome.tabs.get(info.tabId).catch(() => null);
      await collector.record({
        type: 'TAB_ACTIVATED',
        url: tab?.url,
        title: tab?.title,
        tabId: info.tabId,
        windowId: info.windowId,
      });
    },

    async onWindowFocusChanged(windowId: number): Promise<void> {
      if (windowId === NO_WINDOW) {
        // Chrome lost focus entirely. Stop every timer, or time spent in other
        // applications would be counted as time spent reading a page.
        const tabs = await chrome.tabs.query({ active: true });
        await Promise.all(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) => visits.deactivate(tab.id as number)),
        );
        await collector.record({
          type: 'WINDOW_FOCUS_CHANGED',
          metadata: { focused: false },
        });
        return;
      }

      const [active] = await chrome.tabs.query({ active: true, windowId });
      if (active?.id !== undefined) await visits.activate(active.id);

      await collector.record({
        type: 'WINDOW_FOCUS_CHANGED',
        url: active?.url,
        title: active?.title,
        tabId: active?.id,
        windowId,
        metadata: { focused: true },
      });
    },

    /**
     * A committed navigation in the top frame.
     *
     * `webNavigation` is used rather than `tabs.onUpdated` because it fires once
     * per real navigation, where `onUpdated` fires repeatedly as a page loads.
     */
    async onCommitted(details: {
      tabId: number;
      frameId: number;
      url: string;
      transitionType?: string;
    }): Promise<void> {
      if (details.frameId !== 0) return;

      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      const previous = await visits.startVisit(details.tabId, details.url, tab?.active ?? false);

      await collector.record({
        type: 'NAVIGATION',
        url: details.url,
        title: tab?.title,
        tabId: details.tabId,
        windowId: tab?.windowId,
        metadata: {
          transitionType: details.transitionType,
          ...(previous
            ? { previousVisitDurationMs: previous.durationMs, previousUrl: previous.url }
            : {}),
        },
      });
    },

    /**
     * The page finished loading, so the title is finally meaningful and the
     * pixels are worth capturing.
     *
     * Capture hangs off load rather than navigation commit: capturing a page
     * mid-render produces a blank image that costs a vision call to learn
     * nothing from.
     */
    async onCompleted(details: { tabId: number; frameId: number; url: string }): Promise<void> {
      if (details.frameId !== 0) return;

      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      await collector.record({
        type: 'PAGE_LOADED',
        url: details.url,
        title: tab?.title,
        tabId: details.tabId,
        windowId: tab?.windowId,
      });

      // Only the foreground tab has pixels to read; captureVisibleTab would
      // otherwise return whatever the user is actually looking at instead.
      if (tab?.active !== true || tab.windowId === undefined) return;

      await screenshots.capture({
        trigger: 'navigation',
        tabId: details.tabId,
        windowId: tab.windowId,
        url: details.url,
        title: tab.title,
        width: tab.width,
        height: tab.height,
      });
    },
  };
}
