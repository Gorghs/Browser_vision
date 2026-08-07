import { describe, expect, it } from 'vitest';
import { CapturePolicy, EMPTY_CAPTURE_STATE } from './capture-policy.js';
import type { CaptureState } from './capture-policy.js';

const SESSION = 'session-1';

function createPolicy(options: { minAutoIntervalMs?: number; maxPerSession?: number } = {}) {
  let state: CaptureState = { ...EMPTY_CAPTURE_STATE };
  const clock = { now: 1_800_000_000_000 };

  const policy = new CapturePolicy({
    storage: {
      read: () => Promise.resolve(structuredClone(state)),
      write: (next) => {
        state = structuredClone(next);
        return Promise.resolve();
      },
    },
    now: () => clock.now,
    ...options,
  });

  return {
    policy,
    clock,
    advance: (ms: number) => {
      clock.now += ms;
    },
    get state() {
      return state;
    },
  };
}

const enabled = {
  sessionId: SESSION,
  visualCaptureEnabled: true,
  captureOnNavigation: true,
};

describe('the master switch', () => {
  it('refuses every capture while visual capture is off', async () => {
    const { policy } = createPolicy();

    const decision = await policy.evaluate({
      ...enabled,
      visualCaptureEnabled: false,
      trigger: 'navigation',
      tabId: 1,
    });

    expect(decision).toEqual({ allowed: false, reason: 'visual-capture-disabled' });
  });

  it('refuses a manual capture too, not just automatic ones', async () => {
    const { policy } = createPolicy();

    const decision = await policy.evaluate({
      ...enabled,
      visualCaptureEnabled: false,
      trigger: 'manual',
      tabId: 1,
    });

    expect(decision.allowed).toBe(false);
  });
});

describe('automatic capture is not continuous', () => {
  it('allows the first capture in a tab', async () => {
    const { policy } = createPolicy();

    await expect(policy.evaluate({ ...enabled, trigger: 'navigation', tabId: 1 })).resolves.toEqual(
      { allowed: true },
    );
  });

  it('refuses a second capture in the same tab too soon after', async () => {
    const { policy, advance } = createPolicy({ minAutoIntervalMs: 45_000 });
    await policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });

    advance(10_000);

    expect(await policy.evaluate({ ...enabled, trigger: 'navigation', tabId: 1 })).toEqual({
      allowed: false,
      reason: 'too-soon',
    });
  });

  it('allows it again once the interval has passed', async () => {
    const { policy, advance } = createPolicy({ minAutoIntervalMs: 45_000 });
    await policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });

    advance(45_001);

    expect(await policy.evaluate({ ...enabled, trigger: 'navigation', tabId: 1 })).toEqual({
      allowed: true,
    });
  });

  it('rate limits each tab separately', async () => {
    const { policy } = createPolicy({ minAutoIntervalMs: 45_000 });
    await policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });

    expect(await policy.evaluate({ ...enabled, trigger: 'navigation', tabId: 2 })).toEqual({
      allowed: true,
    });
  });

  it('honours the setting that disables capture on navigation', async () => {
    const { policy } = createPolicy();

    const decision = await policy.evaluate({
      ...enabled,
      captureOnNavigation: false,
      trigger: 'navigation',
      tabId: 1,
    });

    expect(decision).toEqual({ allowed: false, reason: 'navigation-capture-disabled' });
  });
});

describe('manual capture', () => {
  it('ignores the interval, because the user asked directly', async () => {
    const { policy } = createPolicy({ minAutoIntervalMs: 45_000 });
    await policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });

    expect(await policy.evaluate({ ...enabled, trigger: 'manual', tabId: 1 })).toEqual({
      allowed: true,
    });
  });

  it('works even when capture on navigation is switched off', async () => {
    const { policy } = createPolicy();

    const decision = await policy.evaluate({
      ...enabled,
      captureOnNavigation: false,
      trigger: 'manual',
      tabId: 1,
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('does not reset another tab’s automatic interval', async () => {
    const harness = createPolicy({ minAutoIntervalMs: 45_000 });
    await harness.policy.recordCapture({ trigger: 'navigation', tabId: 2, sessionId: SESSION });

    await harness.policy.recordCapture({ trigger: 'manual', tabId: 1, sessionId: SESSION });

    // Tab 2's interval is untouched, and tab 1 never gained one.
    expect(Object.keys(harness.state.lastAutoCaptureByTab)).toEqual(['2']);
  });
});

describe('the session ceiling', () => {
  it('refuses once the session limit is reached', async () => {
    const { policy } = createPolicy({ maxPerSession: 2 });

    await policy.recordCapture({ trigger: 'manual', tabId: 1, sessionId: SESSION });
    await policy.recordCapture({ trigger: 'manual', tabId: 1, sessionId: SESSION });

    expect(await policy.evaluate({ ...enabled, trigger: 'manual', tabId: 1 })).toEqual({
      allowed: false,
      reason: 'session-limit',
    });
  });

  it('counts manual and automatic captures against the same budget', async () => {
    const { policy } = createPolicy({ maxPerSession: 2 });

    await policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });
    await policy.recordCapture({ trigger: 'manual', tabId: 2, sessionId: SESSION });

    expect(await policy.evaluate({ ...enabled, trigger: 'manual', tabId: 3 })).toMatchObject({
      allowed: false,
      reason: 'session-limit',
    });
  });

  it('starts a fresh budget for a new session', async () => {
    const { policy } = createPolicy({ maxPerSession: 1 });
    await policy.recordCapture({ trigger: 'manual', tabId: 1, sessionId: SESSION });

    const decision = await policy.evaluate({
      ...enabled,
      sessionId: 'session-2',
      trigger: 'manual',
      tabId: 1,
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('clears the per-tab intervals when the session changes', async () => {
    const harness = createPolicy();
    await harness.policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });
    expect(harness.state.lastAutoCaptureByTab).not.toEqual({});

    await harness.policy.evaluate({
      ...enabled,
      sessionId: 'session-2',
      trigger: 'navigation',
      tabId: 1,
    });

    expect(harness.state.lastAutoCaptureByTab).toEqual({});
  });
});

describe('forgetTab', () => {
  it('drops the interval for a closed tab, since Chrome reuses tab ids', async () => {
    const harness = createPolicy();
    await harness.policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });
    expect(harness.state.lastAutoCaptureByTab).toHaveProperty('1');

    await harness.policy.forgetTab(1);

    expect(harness.state.lastAutoCaptureByTab).toEqual({});
  });

  it('lets the tab that inherits the id capture immediately', async () => {
    const { policy } = createPolicy({ minAutoIntervalMs: 45_000 });
    await policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });
    await policy.forgetTab(1);

    expect(await policy.evaluate({ ...enabled, trigger: 'navigation', tabId: 1 })).toEqual({
      allowed: true,
    });
  });

  it('does nothing for a tab it never saw', async () => {
    const { policy } = createPolicy();

    await expect(policy.forgetTab(99)).resolves.toBeUndefined();
  });
});

describe('persistence', () => {
  it('keeps counters in storage, since the worker is killed constantly', async () => {
    const harness = createPolicy();

    await harness.policy.recordCapture({ trigger: 'navigation', tabId: 1, sessionId: SESSION });

    expect(harness.state.sessionCaptureCount).toBe(1);
    expect(harness.state.sessionId).toBe(SESSION);
  });
});
