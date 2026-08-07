import type { BrowserEvent } from '@vab/types';
import type { QueueScheduler, QueueStorage } from './event-queue.js';
import type { SessionStorage, StoredSession } from './session-manager.js';
import type { OpenVisit, VisitStorage } from './visit-tracker.js';

/**
 * Adapters binding the background modules to Chrome.
 *
 * Everything Chrome-specific lives here so that the queue, session manager and
 * collector stay plain TypeScript and can be tested without a browser.
 */

const QUEUE_KEY = 'eventQueue';
const SESSION_KEY = 'currentSession';
const VISITS_KEY = 'openVisits';
const INSTALLATION_KEY = 'installationId';
const STATUS_KEY = 'agentStatus';

/** Alarm that flushes the queue after the worker has been killed and revived. */
export const FLUSH_ALARM = 'vab-flush-queue';

export function createQueueStorage(): QueueStorage {
  return {
    async read() {
      const stored = await chrome.storage.local.get(QUEUE_KEY);
      const value = stored[QUEUE_KEY];
      return Array.isArray(value) ? (value as BrowserEvent[]) : [];
    },
    async write(events) {
      await chrome.storage.local.set({ [QUEUE_KEY]: events });
    },
  };
}

export function createSessionStorage(): SessionStorage {
  return {
    async read() {
      const stored = await chrome.storage.local.get(SESSION_KEY);
      const value = stored[SESSION_KEY];
      return value && typeof value === 'object' ? (value as StoredSession) : null;
    },
    async write(session) {
      if (session === null) {
        await chrome.storage.local.remove(SESSION_KEY);
        return;
      }
      await chrome.storage.local.set({ [SESSION_KEY]: session });
    },
  };
}

export function createVisitStorage(): VisitStorage {
  return {
    async read() {
      const stored = await chrome.storage.local.get(VISITS_KEY);
      const value = stored[VISITS_KEY];
      return value && typeof value === 'object' ? (value as Record<string, OpenVisit>) : {};
    },
    async write(visits) {
      await chrome.storage.local.set({ [VISITS_KEY]: visits });
    },
  };
}

/**
 * Retries use `setTimeout` rather than an alarm because Chrome clamps alarms to
 * a 30-second floor, far too coarse for a two-second backoff. If the worker is
 * killed before the timeout fires, the periodic flush alarm picks the work up.
 */
export function createTimeoutScheduler(): QueueScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(delayMs, task) {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(task, delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * A stable random identifier for this browser profile.
 *
 * It is not an account and says nothing about the person: it exists so the
 * backend can group sessions that came from the same install.
 */
export async function getInstallationId(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTALLATION_KEY);
  const existing = stored[INSTALLATION_KEY];
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALLATION_KEY]: created });
  return created;
}

/** Delivery statistics shown in the popup. */
export interface StatusRecord {
  deliveredEvents: number;
  lastFlushAt: string | null;
  lastError: string | null;
  droppedEvents: number;
}

const EMPTY_STATUS: StatusRecord = {
  deliveredEvents: 0,
  lastFlushAt: null,
  lastError: null,
  droppedEvents: 0,
};

export async function readStatus(): Promise<StatusRecord> {
  const stored = await chrome.storage.local.get(STATUS_KEY);
  const value = stored[STATUS_KEY];
  if (!value || typeof value !== 'object') return { ...EMPTY_STATUS };
  return { ...EMPTY_STATUS, ...(value as Partial<StatusRecord>) };
}

export async function updateStatus(patch: Partial<StatusRecord>): Promise<void> {
  const next = { ...(await readStatus()), ...patch };
  await chrome.storage.local.set({ [STATUS_KEY]: next });
}
