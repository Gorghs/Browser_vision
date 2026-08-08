import { describe, expect, it } from 'vitest';
import { analyticsSummarySchema } from './analytics.js';

const summary = {
  totals: {
    events: 42,
    sessions: 3,
    liveSessions: 1,
    screenshots: 7,
    analysedScreenshots: 4,
  },
  topDomains: [
    { domain: 'github.com', events: 20 },
    { domain: 'example.com', events: 2 },
  ],
  categories: [{ category: 'development', count: 2 }],
};

describe('analyticsSummarySchema', () => {
  it('accepts a summary', () => {
    expect(analyticsSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('accepts empty aggregates', () => {
    expect(
      analyticsSummarySchema.safeParse({
        totals: {
          events: 0,
          sessions: 0,
          liveSessions: 0,
          screenshots: 0,
          analysedScreenshots: 0,
        },
        topDomains: [],
        categories: [],
      }).success,
    ).toBe(true);
  });

  it('rejects a negative total', () => {
    const result = analyticsSummarySchema.safeParse({
      ...summary,
      totals: { ...summary.totals, events: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown activity category', () => {
    const result = analyticsSummarySchema.safeParse({
      ...summary,
      categories: [{ category: 'nonsense', count: 1 }],
    });
    expect(result.success).toBe(false);
  });
});
