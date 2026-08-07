import { z } from 'zod';

/**
 * What a vision model is asked to produce.
 *
 * Structured rather than prose, so the result can be filtered, grouped and
 * validated. A model that returns something else is retried and then discarded —
 * never stored — which is why every field here is either bounded or optional.
 */

/**
 * A closed vocabulary rather than free text.
 *
 * Left open-ended, models invent a new synonym for "documentation" on every
 * call and the category becomes useless for grouping. `other` exists so a model
 * facing something genuinely unusual has an honest answer available.
 */
export const ACTIVITY_CATEGORIES = [
  'development',
  'documentation',
  'research',
  'communication',
  'social',
  'entertainment',
  'shopping',
  'productivity',
  'news',
  'education',
  'other',
] as const;

export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES);
export type ActivityCategory = z.infer<typeof activityCategorySchema>;

/** What the model saw on the page. */
export const pageUnderstandingSchema = z.object({
  /** A short slug such as `github_issue` or `api_reference`. */
  pageType: z.string().min(1).max(60),
  category: activityCategorySchema,
  /** One sentence on what the page is for. */
  purpose: z.string().min(1).max(400),
  /** The handful of things that dominate the page. */
  importantElements: z.array(z.string().min(1).max(120)).max(10).default([]),
  /** What the page is about, in the model's words. */
  visibleContentSummary: z.string().max(600).optional(),
});

export type PageUnderstanding = z.infer<typeof pageUnderstandingSchema>;

/** What the model infers the person was doing. */
export const activityUnderstandingSchema = z.object({
  /** Why they are on this page. */
  userIntent: z.string().min(1).max(400),
  /** The larger task this page is a step in. */
  currentTask: z.string().min(1).max(400),
  activityCategory: activityCategorySchema,
  /** One line a human would recognise as a description of the moment. */
  summary: z.string().min(1).max(400),
  /**
   * The model's own confidence.
   *
   * Kept because a low-confidence reading of a mostly blank page is worth
   * showing differently from a confident one, not because it is precise.
   */
  confidence: z.number().min(0).max(1).optional(),
});

export type ActivityUnderstanding = z.infer<typeof activityUnderstandingSchema>;

/** The complete structured response a provider must return. */
export const visionAnalysisSchema = z.object({
  page: pageUnderstandingSchema,
  activity: activityUnderstandingSchema,
});

export type VisionAnalysis = z.infer<typeof visionAnalysisSchema>;

/** A stored analysis, as the API returns it. */
export const storedAnalysisSchema = visionAnalysisSchema.extend({
  id: z.uuid(),
  screenshotId: z.uuid(),
  sessionId: z.uuid(),
  provider: z.string(),
  model: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type StoredAnalysis = z.infer<typeof storedAnalysisSchema>;
