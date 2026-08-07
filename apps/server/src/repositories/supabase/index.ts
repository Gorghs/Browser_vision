import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { BrowserEvent, BrowserEventType, Session } from '@vab/types';
import { StorageError } from '../../lib/errors.js';
import type {
  EventFilter,
  EventPage,
  EventRepository,
  Repositories,
  SessionRepository,
  TabRepository,
  UserRepository,
} from '../types.js';

/**
 * Supabase-backed persistence.
 *
 * Written against the Supabase JS client directly rather than an ORM, so the
 * queries the database actually runs are visible in the code that issues them.
 */

/** Row shapes, named to match the SQL rather than the API. */
interface EventRow {
  id: string;
  session_id: string;
  type: string;
  occurred_at: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  browser_tab_id: number | null;
  window_id: number | null;
  metadata: Record<string, unknown> | null;
}

function fail(operation: string, error: PostgrestError): never {
  throw new StorageError(`${operation} failed: ${error.message}`, error);
}

function toEvent(row: EventRow): BrowserEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type as BrowserEventType,
    timestamp: new Date(row.occurred_at).toISOString(),
    metadata: row.metadata ?? {},
    ...(row.url !== null ? { url: row.url } : {}),
    ...(row.domain !== null ? { domain: row.domain } : {}),
    ...(row.title !== null ? { title: row.title } : {}),
    ...(row.browser_tab_id !== null ? { tabId: row.browser_tab_id } : {}),
    ...(row.window_id !== null ? { windowId: row.window_id } : {}),
  };
}

export function createSupabaseRepositories(client: SupabaseClient): Repositories {
  const users: UserRepository = {
    async ensure(installationId) {
      // Upsert rather than select-then-insert: two batches from the same fresh
      // install can arrive concurrently, and the unique index would reject one.
      const { data, error } = await client
        .from('users')
        .upsert(
          { installation_id: installationId, last_seen_at: new Date().toISOString() },
          {
            onConflict: 'installation_id',
          },
        )
        .select('id')
        .single<{ id: string }>();

      if (error) fail('Ensuring the user', error);
      return data.id;
    },
  };

  const sessions: SessionRepository = {
    async upsertMany(userId, incoming) {
      if (incoming.length === 0) return;

      const rows = incoming.map((session) => ({
        id: session.id,
        user_id: userId,
        started_at: session.startedAt,
        ended_at: session.endedAt ?? null,
      }));

      const { error } = await client.from('sessions').upsert(rows, { onConflict: 'id' });
      if (error) fail('Upserting sessions', error);
    },

    async list(userId, limit) {
      let sessionQuery = client.from('sessions').select('id, started_at, ended_at');
      if (userId !== null) sessionQuery = sessionQuery.eq('user_id', userId);

      const { data, error } = await sessionQuery
        .order('started_at', { ascending: false })
        .limit(limit)
        .returns<{ id: string; started_at: string; ended_at: string | null }[]>();

      if (error) fail('Listing sessions', error);

      // One aggregate query rather than a count per session, which would be a
      // query per row on the dashboard's main view.
      const counts = await countEventsBySession(
        client,
        data.map((session) => session.id),
      );

      return data.map<Session>((session) => {
        const stats = counts.get(session.id);
        return {
          id: session.id,
          startedAt: new Date(session.started_at).toISOString(),
          ...(session.ended_at !== null
            ? { endedAt: new Date(session.ended_at).toISOString() }
            : {}),
          eventCount: stats?.count ?? 0,
          lastEventAt: stats?.lastEventAt ?? null,
        };
      });
    },
  };

  const tabs: TabRepository = {
    async upsertMany(_userId, incoming) {
      if (incoming.length === 0) return;

      const rows = incoming.map((tab) => ({
        session_id: tab.sessionId,
        browser_tab_id: tab.browserTabId,
        window_id: tab.windowId ?? null,
        last_url: tab.lastUrl ?? null,
        last_title: tab.lastTitle ?? null,
        opened_at: tab.openedAt ?? null,
        closed_at: tab.closedAt ?? null,
      }));

      const { error } = await client
        .from('tabs')
        .upsert(rows, { onConflict: 'session_id,browser_tab_id' });
      if (error) fail('Upserting tabs', error);
    },
  };

  const events: EventRepository = {
    async insertMany(userId, incoming) {
      if (incoming.length === 0) return { inserted: 0, skipped: 0 };

      const rows = incoming.map((event) => ({
        id: event.id,
        session_id: event.sessionId,
        user_id: userId,
        type: event.type,
        occurred_at: event.timestamp,
        url: event.url ?? null,
        domain: event.domain ?? null,
        title: event.title ?? null,
        browser_tab_id: event.tabId ?? null,
        window_id: event.windowId ?? null,
        metadata: event.metadata,
      }));

      // `ignoreDuplicates` makes a re-sent batch a no-op instead of an error,
      // which is the behaviour the extension's retry logic depends on.
      const { data, error } = await client
        .from('events')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
        .select('id')
        .returns<{ id: string }[]>();

      if (error) fail('Inserting events', error);

      const inserted = data.length;
      return { inserted, skipped: incoming.length - inserted };
    },

    async list(userId, filter: EventFilter) {
      let query = client
        .from('events')
        .select(
          'id, session_id, type, occurred_at, url, domain, title, browser_tab_id, window_id, metadata',
          { count: 'exact' },
        );

      if (userId !== null) query = query.eq('user_id', userId);
      if (filter.sessionId !== undefined) query = query.eq('session_id', filter.sessionId);
      if (filter.type !== undefined) query = query.eq('type', filter.type);
      if (filter.domain !== undefined) query = query.eq('domain', filter.domain);

      const { data, error, count } = await query
        .order('occurred_at', { ascending: false })
        .range(filter.offset, filter.offset + filter.limit - 1)
        .returns<EventRow[]>();

      if (error) fail('Listing events', error);

      const page: EventPage = { events: data.map(toEvent), total: count ?? data.length };
      return page;
    },
  };

  return { kind: 'supabase', users, sessions, tabs, events };
}

/**
 * Event counts and latest timestamps for a set of sessions.
 *
 * PostgREST cannot group, so this pulls the timestamps and reduces in memory.
 * Acceptable at Module 1 volumes and for a bounded list of sessions; if the
 * dashboard starts asking for hundreds, this becomes a database view.
 */
async function countEventsBySession(
  client: SupabaseClient,
  sessionIds: string[],
): Promise<Map<string, { count: number; lastEventAt: string }>> {
  const counts = new Map<string, { count: number; lastEventAt: string }>();
  if (sessionIds.length === 0) return counts;

  const { data, error } = await client
    .from('events')
    .select('session_id, occurred_at')
    .in('session_id', sessionIds)
    .returns<{ session_id: string; occurred_at: string }[]>();

  if (error) fail('Counting session events', error);

  for (const row of data) {
    const timestamp = new Date(row.occurred_at).toISOString();
    const existing = counts.get(row.session_id);
    if (!existing) {
      counts.set(row.session_id, { count: 1, lastEventAt: timestamp });
      continue;
    }
    existing.count += 1;
    if (timestamp > existing.lastEventAt) existing.lastEventAt = timestamp;
  }

  return counts;
}
