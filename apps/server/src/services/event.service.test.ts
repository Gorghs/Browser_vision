import { describe, expect, it } from 'vitest';
import type { BrowserEvent } from '@vab/types';
import { deriveSessions, deriveTabs } from './event.service.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = '99999999-9999-4999-8999-999999999999';

let counter = 0;
function event(overrides: Partial<BrowserEvent> = {}): BrowserEvent {
  counter += 1;
  return {
    id: `33333333-3333-4333-8333-${String(counter).padStart(12, '0')}`,
    sessionId: SESSION,
    type: 'PAGE_LOADED',
    timestamp: '2026-08-07T10:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

describe('deriveSessions', () => {
  it('creates one session per distinct session id', () => {
    const sessions = deriveSessions([event(), event(), event({ sessionId: OTHER_SESSION })]);

    expect(sessions).toHaveLength(2);
  });

  it('starts the session at its SESSION_STARTED event', () => {
    const sessions = deriveSessions([
      event({ type: 'SESSION_STARTED', timestamp: '2026-08-07T09:00:00.000Z' }),
      event({ timestamp: '2026-08-07T09:05:00.000Z' }),
    ]);

    expect(sessions[0]?.startedAt).toBe('2026-08-07T09:00:00.000Z');
  });

  it('falls back to the earliest event when the start event was lost', () => {
    const sessions = deriveSessions([
      event({ timestamp: '2026-08-07T09:05:00.000Z' }),
      event({ timestamp: '2026-08-07T09:02:00.000Z' }),
    ]);

    expect(sessions[0]?.startedAt).toBe('2026-08-07T09:02:00.000Z');
  });

  it('is unaffected by the order events arrive in', () => {
    const early = event({ timestamp: '2026-08-07T09:00:00.000Z' });
    const late = event({ timestamp: '2026-08-07T09:30:00.000Z' });

    expect(deriveSessions([late, early])).toEqual(deriveSessions([early, late]));
  });

  it('closes a session that reported SESSION_ENDED', () => {
    const sessions = deriveSessions([
      event({ timestamp: '2026-08-07T09:00:00.000Z' }),
      event({ type: 'SESSION_ENDED', timestamp: '2026-08-07T09:40:00.000Z' }),
    ]);

    expect(sessions[0]?.endedAt).toBe('2026-08-07T09:40:00.000Z');
  });

  it('leaves a running session open', () => {
    expect(deriveSessions([event()])[0]?.endedAt).toBeUndefined();
  });

  it('keeps the latest end when a session reports ending twice', () => {
    const sessions = deriveSessions([
      event({ type: 'SESSION_ENDED', timestamp: '2026-08-07T09:40:00.000Z' }),
      event({ type: 'SESSION_ENDED', timestamp: '2026-08-07T09:50:00.000Z' }),
    ]);

    expect(sessions[0]?.endedAt).toBe('2026-08-07T09:50:00.000Z');
  });

  it('returns nothing for an empty batch', () => {
    expect(deriveSessions([])).toEqual([]);
  });
});

describe('deriveTabs', () => {
  it('ignores events with no tab, such as session lifecycle events', () => {
    expect(deriveTabs([event({ type: 'SESSION_STARTED' })])).toEqual([]);
  });

  it('creates one entry per tab per session', () => {
    const tabs = deriveTabs([
      event({ tabId: 1 }),
      event({ tabId: 1 }),
      event({ tabId: 2 }),
      event({ tabId: 1, sessionId: OTHER_SESSION }),
    ]);

    expect(tabs).toHaveLength(3);
  });

  it('keeps the last known url and title', () => {
    const tabs = deriveTabs([
      event({ tabId: 1, url: 'https://example.com/a', title: 'A' }),
      event({ tabId: 1, url: 'https://example.com/b', title: 'B' }),
    ]);

    expect(tabs[0]).toMatchObject({ lastUrl: 'https://example.com/b', lastTitle: 'B' });
  });

  it('does not lose the url when a later event has none', () => {
    const tabs = deriveTabs([
      event({ tabId: 1, url: 'https://example.com/a' }),
      event({ tabId: 1, type: 'SCROLL' }),
    ]);

    expect(tabs[0]?.lastUrl).toBe('https://example.com/a');
  });

  it('records when the tab was opened and closed', () => {
    const tabs = deriveTabs([
      event({ tabId: 1, type: 'TAB_CREATED', timestamp: '2026-08-07T09:00:00.000Z' }),
      event({ tabId: 1, type: 'TAB_CLOSED', timestamp: '2026-08-07T09:30:00.000Z' }),
    ]);

    expect(tabs[0]).toMatchObject({
      openedAt: '2026-08-07T09:00:00.000Z',
      closedAt: '2026-08-07T09:30:00.000Z',
    });
  });

  it('carries the window id through', () => {
    expect(deriveTabs([event({ tabId: 1, windowId: 4 })])[0]).toMatchObject({ windowId: 4 });
  });
});
