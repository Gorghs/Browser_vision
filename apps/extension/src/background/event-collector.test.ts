import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserEvent } from '@vab/types';
import { DEFAULT_SETTINGS } from '../services/settings.js';
import type { ExtensionSettings } from '../services/settings.js';
import { EventCollector } from './event-collector.js';
import { SessionManager } from './session-manager.js';
import type { SessionStorage, StoredSession } from './session-manager.js';

const NOW = new Date('2026-08-07T10:00:00.000Z');

function createCollector(settingsPatch: Partial<ExtensionSettings> = {}) {
  const collected: BrowserEvent[] = [];
  let session: StoredSession | null = null;
  const sessionStorage: SessionStorage = {
    read: () => Promise.resolve(session),
    write: (next) => {
      session = next;
      return Promise.resolve();
    },
  };

  let ids = 0;
  const settings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    trackingEnabled: true,
    ...settingsPatch,
  };

  const collector = new EventCollector({
    sink: {
      enqueue: (event) => {
        collected.push(event);
        return Promise.resolve();
      },
    },
    sessions: new SessionManager({
      storage: sessionStorage,
      now: () => NOW,
      newId: () => 'session-1',
    }),
    getSettings: () => Promise.resolve(settings),
    now: () => NOW,
    newId: () => {
      ids += 1;
      return `event-${String(ids)}`;
    },
  });

  return { collector, collected, settings };
}

describe('privacy policy', () => {
  it('records nothing while tracking is off', async () => {
    const { collector, collected } = createCollector({ trackingEnabled: false });

    const outcome = await collector.record({ type: 'PAGE_LOADED', url: 'https://example.com' });

    expect(outcome).toEqual({ recorded: false, reason: 'tracking-disabled' });
    expect(collected).toEqual([]);
  });

  it('ignores pages on a blocked domain', async () => {
    const { collector, collected } = createCollector({ blockedDomains: ['bank.example.com'] });

    const outcome = await collector.record({
      type: 'PAGE_LOADED',
      url: 'https://bank.example.com/accounts',
    });

    expect(outcome).toEqual({ recorded: false, reason: 'blocked-domain' });
    expect(collected).toEqual([]);
  });

  it('ignores subdomains of a blocked domain', async () => {
    const { collector } = createCollector({ blockedDomains: ['example.com'] });

    const outcome = await collector.record({
      type: 'PAGE_LOADED',
      url: 'https://secure.example.com/x',
    });

    expect(outcome).toMatchObject({ recorded: false, reason: 'blocked-domain' });
  });

  it('ignores browser-internal pages', async () => {
    const { collector } = createCollector();

    const outcome = await collector.record({ type: 'PAGE_LOADED', url: 'chrome://settings' });

    expect(outcome).toEqual({ recorded: false, reason: 'untrackable-url' });
  });

  it('ignores local files', async () => {
    const { collector } = createCollector();

    const outcome = await collector.record({
      type: 'PAGE_LOADED',
      url: 'file:///home/user/taxes.pdf',
    });

    expect(outcome).toEqual({ recorded: false, reason: 'untrackable-url' });
  });

  it('strips the query string before the event leaves the browser', async () => {
    const { collector, collected } = createCollector();

    await collector.record({
      type: 'NAVIGATION',
      url: 'https://example.com/reset?token=secret&email=a@b.com',
    });

    const navigation = collected.find((event) => event.type === 'NAVIGATION');
    expect(navigation?.url).toBe('https://example.com/reset');
  });

  it('truncates an over-long page title', async () => {
    const { collector, collected } = createCollector();

    await collector.record({
      type: 'PAGE_LOADED',
      url: 'https://example.com',
      title: 'x'.repeat(1000),
    });

    const loaded = collected.find((event) => event.type === 'PAGE_LOADED');
    expect(loaded?.title).toHaveLength(512);
  });
});

describe('normalization', () => {
  it('fills in id, session and timestamp', async () => {
    const { collector, collected } = createCollector();

    await collector.record({ type: 'PAGE_LOADED', url: 'https://example.com/docs' });

    expect(collected.at(-1)).toMatchObject({
      sessionId: 'session-1',
      timestamp: NOW.toISOString(),
      type: 'PAGE_LOADED',
    });
    expect(collected.at(-1)?.id).toBeTruthy();
  });

  it('derives the domain from the url', async () => {
    const { collector, collected } = createCollector();

    await collector.record({ type: 'PAGE_LOADED', url: 'https://www.GitHub.com/a/b' });

    expect(collected.at(-1)?.domain).toBe('github.com');
  });

  it('carries tab and window identity through', async () => {
    const { collector, collected } = createCollector();

    await collector.record({
      type: 'CLICK',
      url: 'https://example.com',
      tabId: 7,
      windowId: 3,
      metadata: { tag: 'BUTTON' },
    });

    expect(collected.at(-1)).toMatchObject({ tabId: 7, windowId: 3, metadata: { tag: 'BUTTON' } });
  });

  it('allows events with no url, such as window focus changes', async () => {
    const { collector, collected } = createCollector();

    const outcome = await collector.record({ type: 'WINDOW_FOCUS_CHANGED', windowId: 2 });

    expect(outcome.recorded).toBe(true);
    expect(collected.at(-1)?.url).toBeUndefined();
  });
});

describe('session lifecycle', () => {
  it('emits SESSION_STARTED before the first real event', async () => {
    const { collector, collected } = createCollector();

    await collector.record({ type: 'PAGE_LOADED', url: 'https://example.com' });

    expect(collected.map((event) => event.type)).toEqual(['SESSION_STARTED', 'PAGE_LOADED']);
  });

  it('does not repeat SESSION_STARTED for later events', async () => {
    const { collector, collected } = createCollector();

    await collector.record({ type: 'PAGE_LOADED', url: 'https://example.com' });
    await collector.record({ type: 'CLICK', url: 'https://example.com' });

    expect(collected.filter((event) => event.type === 'SESSION_STARTED')).toHaveLength(1);
  });

  it('emits SESSION_ENDED when the session is closed', async () => {
    const { collector, collected } = createCollector();
    await collector.record({ type: 'PAGE_LOADED', url: 'https://example.com' });

    await collector.endSession();

    expect(collected.at(-1)?.type).toBe('SESSION_ENDED');
  });

  it('does not emit SESSION_ENDED when no session was running', async () => {
    const { collector, collected } = createCollector();

    await collector.endSession();

    expect(collected).toEqual([]);
  });

  it('starts no session while tracking is off', async () => {
    const { collector, collected } = createCollector({ trackingEnabled: false });

    await collector.startSession();

    expect(collected).toEqual([]);
  });
});

describe('startSession', () => {
  let harness: ReturnType<typeof createCollector>;

  beforeEach(() => {
    harness = createCollector();
  });

  it('emits SESSION_STARTED when the user switches tracking on', async () => {
    await harness.collector.startSession();

    expect(harness.collected.map((event) => event.type)).toEqual(['SESSION_STARTED']);
  });

  it('is idempotent while a session is already running', async () => {
    await harness.collector.startSession();
    await harness.collector.startSession();

    expect(harness.collected).toHaveLength(1);
  });
});
