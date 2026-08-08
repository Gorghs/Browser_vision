import type {
  ActivityCategory,
  AnalyticsSummary,
  CategoryCount,
  TimelineActivity,
} from '@vab/types';
import type { Repositories } from '../repositories/types.js';
import type { VisualRepositories } from '../repositories/visual-types.js';

/**
 * Aggregates what the dashboard's overview and analytics views need.
 *
 * Event and session sums come from the analytics repository, which can count
 * cheaply against whichever store is live. Screenshot totals come from the
 * visual screenshot repository and the category distribution from the stored
 * timeline activities — a category only exists once a timeline has been built,
 * so the overview never guesses one.
 */

const TOP_DOMAINS = 10;
/** Upper bound on activities pulled for the category tally. */
const CATEGORY_ACTIVITY_LIMIT = 500;

export class AnalyticsService {
  constructor(
    private readonly repositories: Repositories,
    private readonly visual: VisualRepositories,
  ) {}

  async summary(userId: string | null = null): Promise<AnalyticsSummary> {
    const [totals, topDomains, screenshots, analysed, activities] = await Promise.all([
      this.repositories.analytics.totals(userId),
      this.repositories.analytics.topDomains(userId, TOP_DOMAINS),
      this.visual.screenshots.list(userId, { limit: 1, offset: 0 }),
      this.visual.screenshots.list(userId, { limit: 1, offset: 0, status: 'completed' }),
      this.visual.timeline.list(userId, undefined, CATEGORY_ACTIVITY_LIMIT),
    ]);

    return {
      totals: {
        ...totals,
        screenshots: screenshots.total,
        analysedScreenshots: analysed.total,
      },
      topDomains,
      categories: tallyCategories(activities),
    };
  }
}

/** Category distribution over activities, most common first. */
export function tallyCategories(activities: TimelineActivity[]): CategoryCount[] {
  const counts = new Map<ActivityCategory, number>();
  for (const activity of activities) {
    counts.set(activity.category, (counts.get(activity.category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}
