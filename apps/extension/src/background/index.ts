import { agent } from './agent.js';
import { FLUSH_ALARM } from './chrome-adapters.js';
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

        case 'REPORT_INTERACTION': {
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
