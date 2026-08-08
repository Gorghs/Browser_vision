import { z } from 'zod';
import { activityCategorySchema } from './vision.js';

/** Headline counts for the overview page. */
export const analyticsTotalsSchema = z.object({
  events: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  /** Sessions that never recorded an end, so they may still be open. */
  liveSessions: z.number().int().nonnegative(),
  screenshots: z.number().int().nonnegative(),
  /** Screenshots whose analysis finished, including those with no AI configured. */
  analysedScreenshots: z.number().int().nonnegative(),
});

export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;

export const domainCountSchema = z.object({
  domain: z.string().min(1),
  events: z.number().int().nonnegative(),
});

export type DomainCount = z.infer<typeof domainCountSchema>;

export const categoryCountSchema = z.object({
  category: activityCategorySchema,
  count: z.number().int().nonnegative(),
});

export type CategoryCount = z.infer<typeof categoryCountSchema>;

/**
 * Everything the overview page needs in one response.
 *
 * Aggregation lives on the server because the dashboard should not have to pull
 * every event to count them, and because the sums are the same shape whether the
 * backing store is Postgres or memory.
 */
export const analyticsSummarySchema = z.object({
  totals: analyticsTotalsSchema,
  /** Most active sites by event count, most active first. */
  topDomains: z.array(domainCountSchema).max(20),
  /** Activity categories across generated timeline activities, most common first. */
  categories: z.array(categoryCountSchema).max(20),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

export const analyticsSummaryResponseSchema = z.object({
  summary: analyticsSummarySchema,
});

export type AnalyticsSummaryResponse = z.infer<typeof analyticsSummaryResponseSchema>;
