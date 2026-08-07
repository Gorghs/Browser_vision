import { z } from 'zod';
import { EVENT_LIMITS, browserEventSchema, browserEventTypeSchema } from './events.js';
import { sessionInfoSchema, sessionSchema } from './session.js';

/**
 * Body of `POST /api/events`.
 *
 * `installationId` identifies the browser profile the extension runs in. It is a
 * random per-install identifier, not an account: Module 1 has no sign-in, and
 * this keeps sessions attributable without collecting anything about a person.
 */
export const ingestEventsRequestSchema = z.object({
  installationId: z.uuid(),
  session: sessionInfoSchema,
  events: z.array(browserEventSchema).min(1).max(EVENT_LIMITS.batchMaxSize),
});

export type IngestEventsRequest = z.infer<typeof ingestEventsRequestSchema>;

export const ingestEventsResponseSchema = z.object({
  /** Events written on this request. */
  accepted: z.number().int().nonnegative(),
  /** Events already present, re-sent because a response was lost. Not an error. */
  duplicates: z.number().int().nonnegative(),
});

export type IngestEventsResponse = z.infer<typeof ingestEventsResponseSchema>;

/** Query string of `GET /api/events`. */
export const listEventsQuerySchema = z.object({
  sessionId: z.uuid().optional(),
  type: browserEventTypeSchema.optional(),
  domain: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const listEventsResponseSchema = z.object({
  events: z.array(browserEventSchema),
  total: z.number().int().nonnegative(),
});

export type ListEventsResponse = z.infer<typeof listEventsResponseSchema>;

/** Query string of `GET /api/sessions`. */
export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
});

export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

/** Shape every failing response uses, so clients need only one error path. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
