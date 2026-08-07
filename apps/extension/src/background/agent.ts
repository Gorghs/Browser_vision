import { BackendClient } from './backend-client.js';
import { CapturePolicy } from './capture-policy.js';
import {
  captureVisibleTab,
  createCaptureStateStorage,
  createQueueStorage,
  createSessionStorage,
  createTimeoutScheduler,
  createVisitStorage,
  getInstallationId,
  hasCapturePermission,
  readStatus,
  updateStatus,
} from './chrome-adapters.js';
import { EventCollector } from './event-collector.js';
import { EventQueue } from './event-queue.js';
import { createBrowserEventHandlers } from './listeners/browser-events.js';
import { ScreenshotEngine } from './screenshot-engine.js';
import { SessionManager } from './session-manager.js';
import { VisitTracker } from './visit-tracker.js';
import { loadSettings, saveSettings } from '../services/settings.js';
import type { AgentStatus } from '../messaging/contract.js';

/**
 * Assembles the background worker's collaborators.
 *
 * Built once per service worker lifetime. Because Chrome restarts that worker
 * freely, nothing here may hold state that matters — every component reads what
 * it needs from storage.
 */

const sessions = new SessionManager({ storage: createSessionStorage() });

const client = new BackendClient(loadSettings);

const queue = new EventQueue({
  send: async (events) => {
    const installationId = await getInstallationId();
    return client.ingest({ installationId, events });
  },
  storage: createQueueStorage(),
  scheduler: createTimeoutScheduler(),
  telemetry: {
    onDelivered(count, at) {
      void (async () => {
        const status = await readStatus();
        await updateStatus({
          deliveredEvents: status.deliveredEvents + count,
          lastFlushAt: at.toISOString(),
          lastError: null,
        });
      })();
    },
    onError(message) {
      console.warn('[agent] delivery problem:', message);
      void updateStatus({ lastError: message });
    },
    onDropped(count, reason) {
      console.warn(`[agent] dropped ${String(count)} event(s): ${reason}`);
      void (async () => {
        const status = await readStatus();
        await updateStatus({ droppedEvents: status.droppedEvents + count });
      })();
    },
  },
});

const collector = new EventCollector({
  sink: queue,
  sessions,
  getSettings: loadSettings,
});

const visits = new VisitTracker(createVisitStorage());

const capturePolicy = new CapturePolicy({ storage: createCaptureStateStorage() });

const screenshots = new ScreenshotEngine({
  policy: capturePolicy,
  sessions,
  collector,
  uploader: {
    upload: async (request) => client.uploadScreenshot(request),
  },
  getSettings: loadSettings,
  getInstallationId,
  captureTab: captureVisibleTab,
  hasCapturePermission,
  onError: (message) => {
    console.warn('[agent]', message);
    void updateStatus({ lastError: message });
  },
});

const handlers = createBrowserEventHandlers({ collector, visits, screenshots, capturePolicy });

export const agent = {
  queue,
  sessions,
  collector,
  screenshots,
  capturePolicy,
  handlers,

  /** Snapshot for the popup. */
  async status(): Promise<AgentStatus> {
    const [settings, session, stats, capturePermissionGranted] = await Promise.all([
      loadSettings(),
      sessions.current(),
      readStatus(),
      hasCapturePermission().catch(() => false),
    ]);
    await queue.restore();

    return {
      trackingEnabled: settings.trackingEnabled,
      sessionId: session?.id ?? null,
      sessionStartedAt: session?.startedAt ?? null,
      queuedEvents: queue.size,
      deliveredEvents: stats.deliveredEvents,
      lastFlushAt: stats.lastFlushAt,
      lastError: stats.lastError,
      capturePermissionGranted,
    };
  },

  /**
   * Applies a tracking change.
   *
   * Switching off ends the session and flushes, so what was already collected
   * still arrives; switching off must not double as "discard my data".
   */
  async setTracking(enabled: boolean): Promise<void> {
    await saveSettings({ trackingEnabled: enabled });
    if (enabled) {
      await collector.startSession();
      return;
    }
    await collector.endSession();
    await queue.flush();
  },
};
