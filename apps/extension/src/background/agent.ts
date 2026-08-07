import { BackendClient } from './backend-client.js';
import {
  createQueueStorage,
  createSessionStorage,
  createTimeoutScheduler,
  createVisitStorage,
  getInstallationId,
  readStatus,
  updateStatus,
} from './chrome-adapters.js';
import { EventCollector } from './event-collector.js';
import { EventQueue } from './event-queue.js';
import { createBrowserEventHandlers } from './listeners/browser-events.js';
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

const handlers = createBrowserEventHandlers({ collector, visits });

export const agent = {
  queue,
  sessions,
  collector,
  handlers,

  /** Snapshot for the popup. */
  async status(): Promise<AgentStatus> {
    const [settings, session, stats] = await Promise.all([
      loadSettings(),
      sessions.current(),
      readStatus(),
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
