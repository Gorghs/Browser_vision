import type { BrowserEvent, IngestEventsResponse, ListEventsQuery } from '@vab/types';
import type { EventPage, Repositories, SessionUpsert, TabUpsert } from '../repositories/types.js';

/**
 * Ingest and query logic.
 *
 * The interesting work is derivation: a batch arrives as a flat list of events,
 * and the sessions and tabs it implies have to be reconstructed from it. The
 * extension does not send session or tab records of its own, because a buffered
 * batch can straddle a session boundary and because a lost SESSION_STARTED must
 * not orphan everything that followed it.
 */

export class EventService {
  constructor(private readonly repositories: Repositories) {}

  async ingest(installationId: string, events: BrowserEvent[]): Promise<IngestEventsResponse> {
    const userId = await this.repositories.users.ensure(installationId);

    // Order matters: an event references a session, and a tab references a
    // session, so foreign keys require sessions to exist first.
    await this.repositories.sessions.upsertMany(userId, deriveSessions(events));

    const { inserted, skipped } = await this.repositories.events.insertMany(userId, events);

    const tabs = deriveTabs(events);
    if (tabs.length > 0) await this.repositories.tabs.upsertMany(userId, tabs);

    return { accepted: inserted, duplicates: skipped };
  }

  /**
   * Reads across every installation.
   *
   * Module 1 has no end-user authentication, so there is no identity for the
   * dashboard to present and nothing honest to scope a read to. The API key is
   * the only gate, and the dashboard is a local tool. Per-user scoping arrives
   * with authentication, which is why the repository already takes a user id.
   */
  list(query: ListEventsQuery): Promise<EventPage> {
    return this.repositories.events.list(null, {
      limit: query.limit,
      offset: query.offset,
      sessionId: query.sessionId,
      type: query.type,
      domain: query.domain,
    });
  }
}

/**
 * Reconstructs sessions from the events that belong to them.
 *
 * A session starts at its SESSION_STARTED event if one is present, and at its
 * earliest event otherwise — so a start event lost to a failed request costs a
 * slightly late start time rather than the whole session.
 */
export function deriveSessions(events: BrowserEvent[]): SessionUpsert[] {
  const sessions = new Map<string, SessionUpsert>();

  for (const event of events) {
    const existing = sessions.get(event.sessionId);

    if (!existing) {
      sessions.set(event.sessionId, {
        id: event.sessionId,
        startedAt: event.timestamp,
        ...(event.type === 'SESSION_ENDED' ? { endedAt: event.timestamp } : {}),
      });
      continue;
    }

    if (event.timestamp < existing.startedAt) existing.startedAt = event.timestamp;

    if (event.type === 'SESSION_ENDED') {
      // Keep the latest end: a session should not appear to close before its
      // last recorded activity.
      if (existing.endedAt === undefined || event.timestamp > existing.endedAt) {
        existing.endedAt = event.timestamp;
      }
    }
  }

  return [...sessions.values()];
}

/**
 * Reconstructs tab state from the events that mention each tab.
 *
 * Later events win for the current URL and title, since the aim is the tab's
 * last known state rather than its history — the history is the events.
 */
export function deriveTabs(events: BrowserEvent[]): TabUpsert[] {
  const tabs = new Map<string, TabUpsert>();

  for (const event of events) {
    if (event.tabId === undefined) continue;

    const key = `${event.sessionId}:${String(event.tabId)}`;
    const tab: TabUpsert = tabs.get(key) ?? {
      sessionId: event.sessionId,
      browserTabId: event.tabId,
    };

    if (event.windowId !== undefined) tab.windowId = event.windowId;
    if (event.url !== undefined) tab.lastUrl = event.url;
    if (event.title !== undefined) tab.lastTitle = event.title;

    if (event.type === 'TAB_CREATED') tab.openedAt = event.timestamp;
    if (event.type === 'TAB_CLOSED') tab.closedAt = event.timestamp;

    tabs.set(key, tab);
  }

  return [...tabs.values()];
}
