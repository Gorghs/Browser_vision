import type { BrowserEvent, ListEventsQuery, Session } from '@vab/types';

/**
 * Persistence contracts.
 *
 * Services depend on these rather than on Supabase, which keeps SQL out of the
 * business logic and lets the API run against an in-memory store when no
 * database is configured.
 */

export interface EventFilter extends Pick<ListEventsQuery, 'limit' | 'offset'> {
  sessionId?: string | undefined;
  type?: BrowserEvent['type'] | undefined;
  domain?: string | undefined;
}

export interface EventPage {
  events: BrowserEvent[];
  total: number;
}

export interface EventRepository {
  /**
   * Writes events, ignoring any whose id is already stored.
   *
   * Duplicates are expected rather than exceptional: the extension resends a
   * batch whenever a response is lost, so ingest must be idempotent.
   */
  insertMany(
    userId: string,
    events: BrowserEvent[],
  ): Promise<{ inserted: number; skipped: number }>;
  /** A null userId reads across every installation; see ARCHITECTURE.md. */
  list(userId: string | null, filter: EventFilter): Promise<EventPage>;
}

/** Session details derived from a batch of events. */
export interface SessionUpsert {
  id: string;
  startedAt: string;
  endedAt?: string | undefined;
}

export interface SessionRepository {
  /** Creates sessions that do not exist and closes ones the batch ended. */
  upsertMany(userId: string, sessions: SessionUpsert[]): Promise<void>;
  /** A null userId reads across every installation; see ARCHITECTURE.md. */
  list(userId: string | null, limit: number): Promise<Session[]>;
}

/** Tab state derived from a batch of events. */
export interface TabUpsert {
  sessionId: string;
  browserTabId: number;
  windowId?: number | undefined;
  lastUrl?: string | undefined;
  lastTitle?: string | undefined;
  openedAt?: string | undefined;
  closedAt?: string | undefined;
}

export interface TabRepository {
  upsertMany(userId: string, tabs: TabUpsert[]): Promise<void>;
}

export interface UserRepository {
  /** Returns the internal user id for an installation, creating it if needed. */
  ensure(installationId: string): Promise<string>;
}

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  tabs: TabRepository;
  events: EventRepository;
  /** Describes the backing store, for the health endpoint and startup logs. */
  readonly kind: 'supabase' | 'memory';
}
