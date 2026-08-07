import { loadSettings, saveSettings } from '../services/settings.js';
import type { AgentStatus, ExtensionMessage } from '../messaging/contract.js';

/**
 * Background service worker entry point.
 *
 * At this stage it only owns the tracking switch, so the popup has something
 * real to talk to. Session, tab and navigation collection are wired in next.
 */

async function buildStatus(): Promise<AgentStatus> {
  const settings = await loadSettings();
  return {
    trackingEnabled: settings.trackingEnabled,
    sessionId: null,
    sessionStartedAt: null,
    queuedEvents: 0,
    deliveredEvents: 0,
    lastFlushAt: null,
    lastError: null,
  };
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  void (async () => {
    switch (message.kind) {
      case 'SET_TRACKING':
        await saveSettings({ trackingEnabled: message.enabled });
        sendResponse(await buildStatus());
        return;
      case 'GET_STATUS':
      case 'FLUSH_NOW':
        sendResponse(await buildStatus());
        return;
      case 'REPORT_INTERACTION':
        sendResponse({ accepted: false });
        return;
    }
  })();

  // Keeps the message channel open for the async handler above.
  return true;
});
