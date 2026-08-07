import { describe, expect, it } from 'vitest';
import { SessionManager } from './session-manager.js';
import type { SessionStorage, StoredSession } from './session-manager.js';

function createStorage(initial: StoredSession | null = null) {
  let current = initial;
  const storage: SessionStorage = {
    read: () => Promise.resolve(current),
    write: (session) => {
      current = session;
      return Promise.resolve();
    },
  };
  return {
    storage,
    get value() {
      return current;
    },
  };
}

function createManager(options: {
  at: Date;
  initial?: StoredSession | null;
  idleTimeoutMs?: number;
}) {
  const store = createStorage(options.initial ?? null);
  let ids = 0;
  const clock = { now: options.at };
  const manager = new SessionManager({
    storage: store.storage,
    ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
    now: () => clock.now,
    newId: () => {
      ids += 1;
      return `session-${String(ids)}`;
    },
  });
  return { manager, store, clock };
}

const START = new Date('2026-08-07T10:00:00.000Z');

describe('ensure', () => {
  it('creates a session when there is none', async () => {
    const { manager } = createManager({ at: START });

    const result = await manager.ensure();

    expect(result.started).toBe(true);
    expect(result.expired).toBeNull();
    expect(result.session.startedAt).toBe(START.toISOString());
  });

  it('reuses the session while activity continues', async () => {
    const { manager, clock } = createManager({ at: START });
    const first = await manager.ensure();

    clock.now = new Date(START.getTime() + 60_000);
    const second = await manager.ensure();

    expect(second.started).toBe(false);
    expect(second.session.id).toBe(first.session.id);
  });

  it('advances last activity so the idle window slides', async () => {
    const { manager, clock, store } = createManager({ at: START, idleTimeoutMs: 10_000 });
    await manager.ensure();

    clock.now = new Date(START.getTime() + 9_000);
    await manager.ensure();
    clock.now = new Date(START.getTime() + 17_000);
    const third = await manager.ensure();

    // 17s after the start but only 8s after the last event: still one session.
    expect(third.started).toBe(false);
    expect(store.value?.lastActivityAt).toBe(new Date(START.getTime() + 17_000).toISOString());
  });

  it('starts a new session after the idle timeout', async () => {
    const { manager, clock } = createManager({ at: START, idleTimeoutMs: 10_000 });
    const first = await manager.ensure();

    clock.now = new Date(START.getTime() + 11_000);
    const second = await manager.ensure();

    expect(second.started).toBe(true);
    expect(second.session.id).not.toBe(first.session.id);
  });

  it('reports the expired session so it can be closed at its last activity', async () => {
    const { manager, clock } = createManager({ at: START, idleTimeoutMs: 10_000 });
    const first = await manager.ensure();

    clock.now = new Date(START.getTime() + 60_000);
    const second = await manager.ensure();

    expect(second.expired?.id).toBe(first.session.id);
    expect(second.expired?.lastActivityAt).toBe(START.toISOString());
  });

  it('survives a worker restart by reading the stored session', async () => {
    const stored: StoredSession = {
      id: 'session-from-before',
      startedAt: START.toISOString(),
      lastActivityAt: START.toISOString(),
    };
    const { manager, clock } = createManager({ at: START, initial: stored });

    clock.now = new Date(START.getTime() + 5_000);
    const result = await manager.ensure();

    expect(result.started).toBe(false);
    expect(result.session.id).toBe('session-from-before');
  });
});

describe('end', () => {
  it('returns the closed session and clears storage', async () => {
    const { manager, store } = createManager({ at: START });
    await manager.ensure();

    const ended = await manager.end();

    expect(ended).not.toBeNull();
    expect(store.value).toBeNull();
  });

  it('returns null when no session is running', async () => {
    const { manager } = createManager({ at: START });

    await expect(manager.end()).resolves.toBeNull();
  });
});
