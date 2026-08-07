import { SCREENSHOT_LIMITS } from '@vab/types';

/**
 * Decides whether a screenshot may be taken.
 *
 * Separated from the code that takes them so the rules can be read and tested
 * on their own. The specification is explicit that captures must not be
 * continuous and that the policy must be configurable; this is that policy.
 *
 * Counters live in storage because the service worker is killed constantly, and
 * a rate limit held in memory would reset every time it woke up — which is to
 * say it would not be a rate limit.
 */

export interface CaptureState {
  /** Last automatic capture per Chrome tab id, as epoch milliseconds. */
  lastAutoCaptureByTab: Record<string, number>;
  /** Captures taken during the current session. */
  sessionCaptureCount: number;
  /** Which session `sessionCaptureCount` refers to. */
  sessionId: string | null;
}

export interface CaptureStateStorage {
  read(): Promise<CaptureState>;
  write(state: CaptureState): Promise<void>;
}

export const EMPTY_CAPTURE_STATE: CaptureState = {
  lastAutoCaptureByTab: {},
  sessionCaptureCount: 0,
  sessionId: null,
};

export type CaptureTrigger = 'manual' | 'navigation';

export type CaptureDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        'visual-capture-disabled' | 'navigation-capture-disabled' | 'too-soon' | 'session-limit';
    };

export interface CapturePolicyOptions {
  storage: CaptureStateStorage;
  now?: () => number;
  minAutoIntervalMs?: number;
  maxPerSession?: number;
}

export interface CaptureRequest {
  trigger: CaptureTrigger;
  tabId: number;
  sessionId: string;
  visualCaptureEnabled: boolean;
  captureOnNavigation: boolean;
}

export class CapturePolicy {
  private readonly now: () => number;
  private readonly minAutoIntervalMs: number;
  private readonly maxPerSession: number;

  constructor(private readonly options: CapturePolicyOptions) {
    this.now = options.now ?? (() => Date.now());
    this.minAutoIntervalMs = options.minAutoIntervalMs ?? SCREENSHOT_LIMITS.minAutoIntervalMs;
    this.maxPerSession = options.maxPerSession ?? SCREENSHOT_LIMITS.maxPerSession;
  }

  async evaluate(request: CaptureRequest): Promise<CaptureDecision> {
    if (!request.visualCaptureEnabled) {
      return { allowed: false, reason: 'visual-capture-disabled' };
    }

    const state = await this.currentStateFor(request.sessionId);

    if (state.sessionCaptureCount >= this.maxPerSession) {
      return { allowed: false, reason: 'session-limit' };
    }

    // A manual capture is the user asking directly, so it skips the interval
    // check. It still counts against the session ceiling.
    if (request.trigger === 'manual') return { allowed: true };

    if (!request.captureOnNavigation) {
      return { allowed: false, reason: 'navigation-capture-disabled' };
    }

    const last = state.lastAutoCaptureByTab[String(request.tabId)];
    if (last !== undefined && this.now() - last < this.minAutoIntervalMs) {
      return { allowed: false, reason: 'too-soon' };
    }

    return { allowed: true };
  }

  /** Records a capture that actually happened. Never called for a refusal. */
  async recordCapture(
    request: Pick<CaptureRequest, 'trigger' | 'tabId' | 'sessionId'>,
  ): Promise<void> {
    const state = await this.currentStateFor(request.sessionId);

    const next: CaptureState = {
      ...state,
      sessionCaptureCount: state.sessionCaptureCount + 1,
    };
    if (request.trigger === 'navigation') {
      next.lastAutoCaptureByTab = {
        ...state.lastAutoCaptureByTab,
        [String(request.tabId)]: this.now(),
      };
    }

    await this.options.storage.write(next);
  }

  /** Stops a closed tab's timestamp lingering as Chrome reuses tab ids. */
  async forgetTab(tabId: number): Promise<void> {
    const state = await this.options.storage.read();
    if (!(String(tabId) in state.lastAutoCaptureByTab)) return;

    const remaining = { ...state.lastAutoCaptureByTab };
    delete remaining[String(tabId)];
    await this.options.storage.write({ ...state, lastAutoCaptureByTab: remaining });
  }

  /** Resets counters when the session changes, so the ceiling is per session. */
  private async currentStateFor(sessionId: string): Promise<CaptureState> {
    const state = await this.options.storage.read();
    if (state.sessionId === sessionId) return state;

    const fresh: CaptureState = { ...EMPTY_CAPTURE_STATE, sessionId };
    await this.options.storage.write(fresh);
    return fresh;
  }
}
