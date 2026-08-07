import { describe, expect, it } from 'vitest';
import { VisitTracker } from './visit-tracker.js';
import type { OpenVisit, VisitStorage } from './visit-tracker.js';

const START = new Date('2026-08-07T10:00:00.000Z');

function createTracker() {
  let visits: Record<string, OpenVisit> = {};
  const storage: VisitStorage = {
    read: () => Promise.resolve(structuredClone(visits)),
    write: (next) => {
      visits = structuredClone(next);
      return Promise.resolve();
    },
  };
  const clock = { now: START };
  const tracker = new VisitTracker(storage, () => clock.now);
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return {
    tracker,
    clock,
    advance,
    get visits() {
      return visits;
    },
  };
}

describe('foreground time', () => {
  it('counts time while the tab is active', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com', true);

    advance(5_000);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(5_000);
  });

  it('counts nothing for a tab opened in the background', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com', false);

    advance(60_000);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(0);
  });

  it('stops counting once the tab is backgrounded', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com', true);

    advance(3_000);
    await tracker.deactivate(1);
    advance(60_000);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(3_000);
  });

  it('accumulates across several visits to the foreground', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com', true);

    advance(2_000);
    await tracker.deactivate(1);
    advance(10_000);
    await tracker.activate(1);
    advance(3_000);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(5_000);
  });

  it('ignores a second activate while already active', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com', true);

    advance(1_000);
    await tracker.activate(1);
    advance(1_000);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(2_000);
  });

  it('ignores a second deactivate while already inactive', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com', true);

    advance(1_000);
    await tracker.deactivate(1);
    await tracker.deactivate(1);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(1_000);
  });
});

describe('navigating within a tab', () => {
  it('returns the visit that just ended', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com/a', true);

    advance(4_000);
    const previous = await tracker.startVisit(1, 'https://example.com/b', true);

    expect(previous).toMatchObject({ url: 'https://example.com/a', durationMs: 4_000 });
  });

  it('restarts the timer for the new page', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://example.com/a', true);
    advance(4_000);
    await tracker.startVisit(1, 'https://example.com/b', true);

    advance(1_000);
    const completed = await tracker.endVisit(1);

    expect(completed?.durationMs).toBe(1_000);
  });

  it('returns null for the first page in a tab', async () => {
    const { tracker } = createTracker();

    await expect(tracker.startVisit(1, 'https://example.com', true)).resolves.toBeNull();
  });
});

describe('tab isolation', () => {
  it('tracks tabs independently', async () => {
    const { tracker, advance } = createTracker();
    await tracker.startVisit(1, 'https://one.example', true);
    await tracker.startVisit(2, 'https://two.example', false);

    advance(5_000);

    expect((await tracker.endVisit(1))?.durationMs).toBe(5_000);
    expect((await tracker.endVisit(2))?.durationMs).toBe(0);
  });

  it('forgets a tab once it is closed', async () => {
    const { tracker, visits } = createTracker();
    await tracker.startVisit(1, 'https://example.com', true);

    await tracker.endVisit(1);

    expect(Object.keys(visits)).toEqual([]);
  });

  it('returns null when ending a tab it never saw', async () => {
    const { tracker } = createTracker();

    await expect(tracker.endVisit(99)).resolves.toBeNull();
  });
});
