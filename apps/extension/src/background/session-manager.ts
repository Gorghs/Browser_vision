/**
 * Owns the lifetime of a browsing session.
 *
 * A session is a stretch of continuous activity, not a browser run: Chrome
 * terminates the service worker constantly, so session state lives in storage
 * and is re-read rather than held in a module variable.
 */

export interface StoredSession {
  id: string;
  startedAt: string;
  /** Timestamp of the most recent event, used to detect an idle gap. */
  lastActivityAt: string;
}

export interface SessionStorage {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession | null): Promise<void>;
}

export interface SessionManagerOptions {
  storage: SessionStorage;
  /** Inactivity after which the next event belongs to a new session. */
  idleTimeoutMs?: number;
  now?: () => Date;
  newId?: () => string;
}

/** Thirty minutes: long enough to survive reading an article, short enough that
 * yesterday's browsing does not merge into today's. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;

export interface EnsureResult {
  session: StoredSession;
  /** True when this call created the session, so a start event is owed. */
  started: boolean;
  /** The session this one replaced, if it was closed by the idle timeout. */
  expired: StoredSession | null;
}

export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly idleTimeoutMs: number;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: SessionManagerOptions) {
    this.storage = options.storage;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  current(): Promise<StoredSession | null> {
    return this.storage.read();
  }

  /**
   * Returns the session an event belongs to, creating one if needed.
   *
   * The idle check happens here rather than on a timer because a timer cannot
   * be trusted to run: the worker may have been dead for the whole gap.
   */
  async ensure(): Promise<EnsureResult> {
    const now = this.now();
    const existing = await this.storage.read();

    if (existing) {
      const idleFor = now.getTime() - new Date(existing.lastActivityAt).getTime();
      if (idleFor < this.idleTimeoutMs) {
        const session = { ...existing, lastActivityAt: now.toISOString() };
        await this.storage.write(session);
        return { session, started: false, expired: null };
      }
      const session = this.create(now);
      await this.storage.write(session);
      return { session, started: true, expired: existing };
    }

    const session = this.create(now);
    await this.storage.write(session);
    return { session, started: true, expired: null };
  }

  /** Closes the current session and returns it, or null if there was none. */
  async end(): Promise<StoredSession | null> {
    const existing = await this.storage.read();
    if (!existing) return null;
    await this.storage.write(null);
    return existing;
  }

  private create(now: Date): StoredSession {
    const timestamp = now.toISOString();
    return { id: this.newId(), startedAt: timestamp, lastActivityAt: timestamp };
  }
}
