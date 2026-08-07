import type { BrowserEventType } from '@vab/types';

/**
 * The message contract between the extension's three contexts.
 *
 * Popup and content script both talk to the background worker and never to each
 * other. Keeping every message shape in one file means a request and its handler
 * cannot drift apart without a type error.
 */

/** Reported by the content script; the background worker adds identity and time. */
export interface InteractionReport {
  type: Extract<BrowserEventType, 'CLICK' | 'SCROLL' | 'FOCUS' | 'BLUR' | 'TEXT_SELECTED'>;
  /** Page-supplied context. Never contains form field values. */
  metadata: Record<string, unknown>;
}

/** Snapshot the popup renders. */
export interface AgentStatus {
  trackingEnabled: boolean;
  sessionId: string | null;
  sessionStartedAt: string | null;
  /** Events collected but not yet delivered to the backend. */
  queuedEvents: number;
  /** Events successfully delivered during this session. */
  deliveredEvents: number;
  lastFlushAt: string | null;
  /** Most recent delivery failure, cleared by the next success. */
  lastError: string | null;
}

export type ExtensionMessage =
  | { kind: 'GET_STATUS' }
  | { kind: 'SET_TRACKING'; enabled: boolean }
  | { kind: 'FLUSH_NOW' }
  | { kind: 'REPORT_INTERACTION'; report: InteractionReport };

/** Maps each message to the reply its handler produces. */
export interface ExtensionMessageResults {
  GET_STATUS: AgentStatus;
  SET_TRACKING: AgentStatus;
  FLUSH_NOW: AgentStatus;
  REPORT_INTERACTION: { accepted: boolean };
}

export type ExtensionMessageResult<K extends ExtensionMessage['kind']> = ExtensionMessageResults[K];

/**
 * Sends a message to the background worker.
 *
 * Returns null instead of throwing when the worker is unreachable — during
 * extension reload, or after the popup closes. Callers treat that as "no status
 * available", which is true and not worth an error path of its own.
 */
export async function sendToBackground<M extends ExtensionMessage>(
  message: M,
): Promise<ExtensionMessageResult<M['kind']> | null> {
  try {
    // `sendMessage` is typed as returning `any`; narrowing to `unknown` first
    // keeps the assertion meaningful rather than silently trusting the API.
    const response: unknown = await chrome.runtime.sendMessage(message);
    return response as ExtensionMessageResult<M['kind']>;
  } catch {
    return null;
  }
}
