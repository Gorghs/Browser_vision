import { z } from 'zod';

const isoTimestamp = z.iso.datetime({ offset: true });

/**
 * Session details sent alongside every batch.
 *
 * Repeating it on each request is a little redundant, but it means a batch can
 * create the session it belongs to. Events therefore survive a dropped
 * SESSION_STARTED request instead of arriving orphaned.
 */
export const sessionInfoSchema = z.object({
  id: z.uuid(),
  startedAt: isoTimestamp,
  endedAt: isoTimestamp.optional(),
  /** Reported by the extension so sessions can be told apart across browsers. */
  browser: z.string().max(120).optional(),
});

export type SessionInfo = z.infer<typeof sessionInfoSchema>;

/** A session as returned by the API, enriched with server-side aggregates. */
export const sessionSchema = sessionInfoSchema.extend({
  eventCount: z.number().int().nonnegative(),
  lastEventAt: isoTimestamp.nullable(),
});

export type Session = z.infer<typeof sessionSchema>;
