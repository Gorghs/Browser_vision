import { agent } from './agent.js';
import { FLUSH_ALARM } from './chrome-adapters.js';
import { loadSettings } from '../services/settings.js';
import type { ExtensionMessage } from '../messaging/contract.js';

/**
 * Background service worker entry point.
 *
 * Registers listeners at the top level — Chrome requires that, since the worker
 * is woken by the events themselves — and delegates everything else to `agent`.
 */

/**
 * Backstop flush.
 *
 * Chrome clamps alarms to a 30-second floor, so this is not the primary flush
 * path; the queue's own scheduler handles that while the worker is alive. This
 * exists to drain events left behind when the worker was killed mid-backoff.
 */
const FLUSH_PERIOD_MINUTES = 1;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FLUSH_ALARM) return;
  void agent.queue.flush();
});

/**
 * Browser activity listeners.
 *
 * Chrome's listener signatures are synchronous, so each handler is launched with
 * `void` and reports its own failures. Every one of them funnels through the
 * collector, which decides whether anything is recorded at all.
 */
const { handlers } = agent;

function run(work: Promise<void>, label: string): void {
  work.catch((cause: unknown) => {
    console.error(`[agent] ${label} failed:`, cause);
  });
}

chrome.tabs.onCreated.addListener((tab) => run(handlers.onTabCreated(tab), 'tabs.onCreated'));

chrome.tabs.onRemoved.addListener((tabId, info) =>
  run(handlers.onTabRemoved(tabId, info), 'tabs.onRemoved'),
);

chrome.tabs.onActivated.addListener((info) =>
  run(handlers.onTabActivated(info), 'tabs.onActivated'),
);

chrome.windows.onFocusChanged.addListener((windowId) =>
  run(handlers.onWindowFocusChanged(windowId), 'windows.onFocusChanged'),
);

chrome.webNavigation.onCommitted.addListener((details) =>
  run(handlers.onCommitted(details), 'webNavigation.onCommitted'),
);

chrome.webNavigation.onCompleted.addListener((details) =>
  run(handlers.onCompleted(details), 'webNavigation.onCompleted'),
);

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.kind) {
        case 'GET_STATUS':
          sendResponse(await agent.status());
          return;

        case 'SET_TRACKING':
          await agent.setTracking(message.enabled);
          sendResponse(await agent.status());
          return;

        case 'FLUSH_NOW':
          await agent.queue.flush();
          sendResponse(await agent.status());
          return;

        case 'CAPTURE_NOW': {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab?.id === undefined || tab.windowId === undefined) {
            sendResponse({ captured: false, reason: 'no-active-tab' });
            return;
          }
          const outcome = await agent.screenshots.capture({
            trigger: 'manual',
            tabId: tab.id,
            windowId: tab.windowId,
            url: tab.url,
            title: tab.title,
            width: tab.width,
            height: tab.height,
          });
          sendResponse({
            captured: outcome.captured,
            ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
          });
          return;
        }

        case 'REPORT_INTERACTION': {
          // Re-checked here rather than trusted to the content script, which may
          // be running an older copy of the settings on a long-open page.
          if (!(await loadSettings()).trackInteractions) {
            sendResponse({ accepted: false });
            return;
          }

          // The content script is untrusted input: it reports what happened, but
          // the tab's identity comes from the sender, which the page cannot forge.
          const tab = sender.tab;
          const outcome = await agent.collector.record({
            type: message.report.type,
            url: tab?.url,
            title: tab?.title,
            tabId: tab?.id,
            windowId: tab?.windowId,
            metadata: message.report.metadata,
          });
          sendResponse({ accepted: outcome.recorded });
          return;
        }
      }
    } catch (cause) {
      console.error('[agent] message handler failed:', cause);
      sendResponse(null);
    }
  })();

  // Tells Chrome to keep the message channel open for the async handler above.
  return true;
});
