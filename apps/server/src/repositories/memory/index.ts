import type { BrowserEvent, Session } from '@vab/types';
import type {
  EventFilter,
  EventPage,
  EventRepository,
  Repositories,
  SessionRepository,
  SessionUpsert,
  TabRepository,
  TabUpsert,
  UserRepository,
} from '../types.js';

/**
 * In-memory storage.
 *
 * Used when no Supabase credentials are configured, so the whole pipeline —
 * extension through API to dashboard — can be run and demonstrated without an
 * account. Data does not survive a restart, which the server states plainly at
 * startup and through the health endpoint.
 *
 * It is also what the API tests run against, which keeps them fast and free of
 * a network dependency.
 */

interface StoredSession extends SessionUpsert {
  userId: string;
}

interface StoredTab extends TabUpsert {
  userId: string;
}

export function createMemoryRepositories(): Repositories {
  const usersByInstallation = new Map<string, string>();
  const sessions = new Map<string, StoredSession>();
  const tabs = new Map<string, StoredTab>();
  /** Keyed by event id, which is what makes re-sent batches idempotent. */
  const events = new Map<string, BrowserEvent & { userId: string }>();

  const users: UserRepository = {
    ensure(installationId) {
      const existing = usersByInstallation.get(installationId);
      if (existing) return Promise.resolve(existing);

      const id = crypto.randomUUID();
      usersByInstallation.set(installationId, id);
      return Promise.resolve(id);
    },
  };

  const sessionRepository: SessionRepository = {
    upsertMany(userId, incoming) {
      for (const session of incoming) {
        const existing = sessions.get(session.id);
        if (!existing) {
          sessions.set(session.id, { ...session, userId });
          continue;
        }
        sessions.set(session.id, {
          ...existing,
          // Keep the earliest start seen: batches can arrive out of order.
          startedAt:
            existing.startedAt < session.startedAt ? existing.startedAt : session.startedAt,
          endedAt: session.endedAt ?? existing.endedAt,
        });
      }
      return Promise.resolve();
    },

    list(userId, limit) {
      const owned = [...sessions.values()].filter(
        (session) => userId === null || session.userId === userId,
      );

      const result: Session[] = owned.map((session) => {
        const sessionEvents = [...events.values()].filter(
          (event) => event.sessionId === session.id,
        );
        const lastEventAt = sessionEvents.reduce<string | null>(
          (latest, event) =>
            latest === null || event.timestamp > latest ? event.timestamp : latest,
          null,
        );
        return {
          id: session.id,
          startedAt: session.startedAt,
          ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
          eventCount: sessionEvents.length,
          lastEventAt,
        };
      });

      result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return Promise.resolve(result.slice(0, limit));
    },
  };

  const tabRepository: TabRepository = {
    upsertMany(userId, incoming) {
      for (const tab of incoming) {
        const key = `${tab.sessionId}:${String(tab.browserTabId)}`;
        const existing = tabs.get(key);
        tabs.set(key, {
          ...existing,
          ...tab,
          userId,
          openedAt: existing?.openedAt ?? tab.openedAt,
        });
      }
      return Promise.resolve();
    },
  };

  const eventRepository: EventRepository = {
    insertMany(userId, incoming) {
      let inserted = 0;
      let skipped = 0;

      for (const event of incoming) {
        if (events.has(event.id)) {
          skipped += 1;
          continue;
        }
        events.set(event.id, { ...event, userId });
        inserted += 1;
      }

      return Promise.resolve({ inserted, skipped });
    },

    list(userId, filter: EventFilter) {
      const matching = [...events.values()]
        .filter((event) => userId === null || event.userId === userId)
        .filter((event) => filter.sessionId === undefined || event.sessionId === filter.sessionId)
        .filter((event) => filter.type === undefined || event.type === filter.type)
        .filter((event) => filter.domain === undefined || event.domain === filter.domain)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const page: EventPage = {
        total: matching.length,
        events: matching.slice(filter.offset, filter.offset + filter.limit).map((event) => {
          const { userId: _ownerId, ...rest } = event;
          return rest;
        }),
      };
      return Promise.resolve(page);
    },
  };

  return {
    kind: 'memory',
    users,
    sessions: sessionRepository,
    tabs: tabRepository,
    events: eventRepository,
  };
}
