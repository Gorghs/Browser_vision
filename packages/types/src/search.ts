import { z } from 'zod';
import { browserEventSchema } from './events.js';
import { screenshotSchema } from './screenshot.js';
import { storedAnalysisSchema } from './vision.js';
import { timelineActivitySchema } from './timeline.js';

/**
 * Search across everything collected.
 *
 * One endpoint, four result groups. The dashboard cannot reasonably pull every
 * event to search them client-side, so the server matches keywords against
 * URLs, domains, titles, OCR text, AI summaries and timeline descriptions, and
 * returns each kind of hit in the same shape its own list endpoint uses.
 */
export const searchQuerySchema = z.object({
  /** Free text, matched against URLs, domains, titles, OCR and AI text. */
  q: z.string().trim().min(1).max(200),
  sessionId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  events: z.array(browserEventSchema),
  screenshots: z.array(screenshotSchema),
  activities: z.array(timelineActivitySchema),
  /** AI analyses whose summaries, intents or purposes matched. */
  analyses: z.array(storedAnalysisSchema),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;
