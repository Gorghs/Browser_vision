import { z } from 'zod';
import { activityCategorySchema } from './vision.js';

const isoTimestamp = z.iso.datetime({ offset: true });

/**
 * A stretch of browsing described the way a person would describe it.
 *
 * "Researching a GitHub issue" rather than CLICK, SCROLL, SCROLL, NAVIGATION.
 * The raw events remain available underneath; this is the readable layer over
 * them.
 */
export const timelineActivitySchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  startedAt: isoTimestamp,
  endedAt: isoTimestamp,
  /** One line, the headline of the activity. */
  title: z.string().min(1).max(200),
  description: z.string().max(600).nullable(),
  category: activityCategorySchema,
  /** Sites involved, most active first. */
  domains: z.array(z.string()).max(20),
  eventCount: z.number().int().nonnegative(),
  /**
   * Whether a model wrote this description or it was assembled from the events.
   *
   * Recorded because the two are not equally trustworthy, and because the
   * timeline must keep working when no AI is configured — a distinction the
   * dashboard shows rather than hides.
   */
  source: z.enum(['ai', 'derived']),
});

export type TimelineActivity = z.infer<typeof timelineActivitySchema>;

export const listTimelineQuerySchema = z.object({
  sessionId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListTimelineQuery = z.infer<typeof listTimelineQuerySchema>;

export const listTimelineResponseSchema = z.object({
  activities: z.array(timelineActivitySchema),
});

export type ListTimelineResponse = z.infer<typeof listTimelineResponseSchema>;

/**
 * How raw events are cut into activities.
 *
 * A new activity begins when the user moves to a different site, or when they
 * stop for long enough that resuming is a new piece of work rather than a
 * continuation of the old one.
 */
export const TIMELINE_RULES = {
  /** Silence longer than this ends the current activity. */
  idleGapMs: 5 * 60_000,
  /** Below this, a burst of events is noise rather than an activity. */
  minEventsPerActivity: 2,
} as const;
