import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserEvent } from '@vab/types';
import { DEFAULT_SETTINGS } from '../../services/settings.js';
import { installFakeChrome } from '../../testing/fake-chrome.js';
import type { FakeChrome, FakeTab } from '../../testing/fake-chrome.js';
import { EventCollector } from '../event-collector.js';
import { SessionManager } from '../session-manager.js';
import type { SessionStorage, StoredSession } from '../session-manager.js';
import { VisitTracker } from '../visit-tracker.js';
import type { OpenVisit, VisitStorage } from '../visit-tracker.js';
import { createBrowserEventHandlers } from './browser-events.js';

const START = new Date('2026-08-07T10:00:00.000Z');

let fakeChrome: FakeChrome;

function createHarness() {
  const collected: BrowserEvent[] = [];
  const clock = { now: START };

  let session: StoredSession | null = null;
  const sessionStorage: SessionStorage = {
    read: () => Promise.resolve(session),
    write: (next) => {
      session = next;
      return Promise.resolve();
    },
  };

  let visitState: Record<string, OpenVisit> = {};
  const visitStorage: VisitStorage = {
    read: () => Promise.resolve(structuredClone(visitState)),
    write: (next) => {
      visitState = structuredClone(next);
      return Promise.resolve();
    },
  };

  let ids = 0;
  const collector = new EventCollector({
    sink: {
      enqueue: (event) => {
        collected.push(event);
        return Promise.resolve();
      },
    },
    sessions: new SessionManager({
      storage: sessionStorage,
      now: () => clock.now,
      newId: () => 'session-1',
    }),
    getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS, trackingEnabled: true }),
    now: () => clock.now,
    newId: () => {
      ids += 1;
      return `event-${String(ids)}`;
    },
  });

  const handlers = createBrowserEventHandlers({
    collector,
    visits: new VisitTracker(visitStorage, () => clock.now),
  });

  return {
    handlers,
    collected,
    advance: (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    /** Events other than the automatic session bookkeeping. */
    get activity() {
      return collected.filter(
        (event) => event.type !== 'SESSION_STARTED' && event.type !== 'SESSION_ENDED',
      );
    },
  };
}

function tab(overrides: Partial<FakeTab> & { id: number }): FakeTab {
  return { windowId: 1, active: true, ...overrides };
}

beforeEach(() => {
  fakeChrome = installFakeChrome();
});

describe('tab lifecycle', () => {
  it('records a created tab', async () => {
    const harness = createHarness();

    await harness.handlers.onTabCreated(
      tab({ id: 7, url: 'https://example.com', title: 'Example' }) as chrome.tabs.Tab,
    );

    expect(harness.activity[0]).toMatchObject({
      type: 'TAB_CREATED',
      tabId: 7,
      windowId: 1,
      domain: 'example.com',
    });
  });

  it('records a closed tab with the time spent on its last page', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com/a' }));
    const harness = createHarness();
    await harness.handlers.onCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/a' });
    harness.advance(9_000);

    await harness.handlers.onTabRemoved(7, { windowId: 1, isWindowClosing: false });

    expect(harness.activity.at(-1)).toMatchObject({
      type: 'TAB_CLOSED',
      metadata: { visitDurationMs: 9_000, windowClosing: false },
    });
  });

  it('records a closed tab it never saw navigate', async () => {
    const harness = createHarness();

    await harness.handlers.onTabRemoved(7, { windowId: 1, isWindowClosing: true });

    expect(harness.activity.at(-1)).toMatchObject({ type: 'TAB_CLOSED', tabId: 7 });
  });
});

describe('tab activation', () => {
  it('records the newly active tab', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com', title: 'Example' }));
    const harness = createHarness();

    await harness.handlers.onTabActivated({ tabId: 7, windowId: 1 });

    expect(harness.activity.at(-1)).toMatchObject({ type: 'TAB_ACTIVATED', tabId: 7 });
  });

  it('stops the timer on the tab that lost the foreground', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://one.example' }));
    fakeChrome.__tabs.push(tab({ id: 8, url: 'https://two.example', active: false }));
    const harness = createHarness();

    await harness.handlers.onCommitted({ tabId: 7, frameId: 0, url: 'https://one.example' });
    harness.advance(4_000);
    await harness.handlers.onTabActivated({ tabId: 8, windowId: 1 });
    harness.advance(60_000);
    await harness.handlers.onTabRemoved(7, { windowId: 1, isWindowClosing: false });

    // Only the four seconds tab 7 was actually in front should be counted.
    expect(harness.activity.at(-1)?.metadata).toMatchObject({ visitDurationMs: 4_000 });
  });

  it('still records the activation when the tab has already gone', async () => {
    const harness = createHarness();

    await harness.handlers.onTabActivated({ tabId: 404, windowId: 1 });

    expect(harness.activity.at(-1)).toMatchObject({ type: 'TAB_ACTIVATED', tabId: 404 });
  });
});

describe('window focus', () => {
  it('records losing focus and stops counting foreground time', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com' }));
    const harness = createHarness();
    await harness.handlers.onCommitted({ tabId: 7, frameId: 0, url: 'https://example.com' });

    harness.advance(2_000);
    await harness.handlers.onWindowFocusChanged(-1);
    harness.advance(120_000);
    await harness.handlers.onTabRemoved(7, { windowId: 1, isWindowClosing: false });

    expect(harness.activity.at(-1)?.metadata).toMatchObject({ visitDurationMs: 2_000 });
  });

  it('records regaining focus', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com', title: 'Example' }));
    const harness = createHarness();

    await harness.handlers.onWindowFocusChanged(1);

    expect(harness.activity.at(-1)).toMatchObject({
      type: 'WINDOW_FOCUS_CHANGED',
      metadata: { focused: true },
      tabId: 7,
    });
  });

  it('resumes counting when focus returns', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com' }));
    const harness = createHarness();
    await harness.handlers.onCommitted({ tabId: 7, frameId: 0, url: 'https://example.com' });

    harness.advance(1_000);
    await harness.handlers.onWindowFocusChanged(-1);
    harness.advance(50_000);
    await harness.handlers.onWindowFocusChanged(1);
    harness.advance(3_000);
    await harness.handlers.onTabRemoved(7, { windowId: 1, isWindowClosing: false });

    expect(harness.activity.at(-1)?.metadata).toMatchObject({ visitDurationMs: 4_000 });
  });
});

describe('navigation', () => {
  it('records a top-frame navigation', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com/a', title: 'A' }));
    const harness = createHarness();

    await harness.handlers.onCommitted({
      tabId: 7,
      frameId: 0,
      url: 'https://example.com/a',
      transitionType: 'link',
    });

    expect(harness.activity.at(-1)).toMatchObject({
      type: 'NAVIGATION',
      url: 'https://example.com/a',
      domain: 'example.com',
      metadata: { transitionType: 'link' },
    });
  });

  it('ignores navigations in subframes, which are ads and embeds', async () => {
    const harness = createHarness();

    await harness.handlers.onCommitted({ tabId: 7, frameId: 3, url: 'https://ads.example/frame' });

    expect(harness.collected).toEqual([]);
  });

  it('attaches how long the previous page was open', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com/a' }));
    const harness = createHarness();
    await harness.handlers.onCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/a' });

    harness.advance(7_000);
    await harness.handlers.onCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/b' });

    expect(harness.activity.at(-1)?.metadata).toMatchObject({
      previousVisitDurationMs: 7_000,
      previousUrl: 'https://example.com/a',
    });
  });

  it('records the page load separately, once the title is known', async () => {
    fakeChrome.__tabs.push(tab({ id: 7, url: 'https://example.com/a', title: 'Loaded title' }));
    const harness = createHarness();

    await harness.handlers.onCompleted({ tabId: 7, frameId: 0, url: 'https://example.com/a' });

    expect(harness.activity.at(-1)).toMatchObject({
      type: 'PAGE_LOADED',
      title: 'Loaded title',
    });
  });

  it('ignores page loads in subframes', async () => {
    const harness = createHarness();

    await harness.handlers.onCompleted({ tabId: 7, frameId: 2, url: 'https://ads.example' });

    expect(harness.collected).toEqual([]);
  });
});
