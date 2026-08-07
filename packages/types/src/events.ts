import { z } from 'zod';
import { EVENT_LIMITS } from './limits.js';

/**
 * Every kind of browser activity the foundation records.
 *
 * Visual and AI event types (screenshots, OCR, model analysis) belong to later
 * modules and are deliberately absent: the telemetry layer must stand on its own.
 */
export const BROWSER_EVENT_TYPES = [
  'SESSION_STARTED',
  'SESSION_ENDED',

  'TAB_CREATED',
  'TAB_CLOSED',
  'TAB_ACTIVATED',

  'WINDOW_FOCUS_CHANGED',

  'NAVIGATION',
  'PAGE_LOADED',

  'CLICK',
  'SCROLL',
  'FOCUS',
  'BLUR',
  'TEXT_SELECTED',
] as const;

export const browserEventTypeSchema = z.enum(BROWSER_EVENT_TYPES);
export type BrowserEventType = z.infer<typeof browserEventTypeSchema>;

const isoTimestamp = z.iso.datetime({ offset: true });

/**
 * A single normalized browser event.
 *
 * `metadata` stays deliberately loose — each event type carries a different
 * shape, and the pipeline should tolerate an extension version that knows about
 * fields the server does not yet.
 */
export const browserEventSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  type: browserEventTypeSchema,
  timestamp: isoTimestamp,
  url: z.string().max(EVENT_LIMITS.urlMaxLength).optional(),
  domain: z.string().max(255).optional(),
  title: z.string().max(EVENT_LIMITS.titleMaxLength).optional(),
  /** Chrome's tab id — stable only within a browser run, not a database key. */
  tabId: z.number().int().optional(),
  windowId: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type BrowserEvent = z.infer<typeof browserEventSchema>;

/** A browser event before the collector assigns it an id and session. */
export type BrowserEventDraft = Omit<BrowserEvent, 'id' | 'sessionId' | 'timestamp'> & {
  timestamp?: string;
};
