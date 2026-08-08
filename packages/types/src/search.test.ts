import { describe, expect, it } from 'vitest';
import { searchQuerySchema, searchResponseSchema } from './search.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

describe('searchQuerySchema', () => {
  it('accepts a query with defaults', () => {
    const result = searchQuerySchema.safeParse({ q: 'github' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it('trims the query', () => {
    const result = searchQuerySchema.safeParse({ q: '  github  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.q).toBe('github');
  });

  it('rejects an empty query', () => {
    expect(searchQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });
});

describe('searchResponseSchema', () => {
  it('accepts a response with empty groups', () => {
    const result = searchResponseSchema.safeParse({
      query: 'github',
      events: [],
      screenshots: [],
      activities: [],
      analyses: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an event that is not a browser event', () => {
    const result = searchResponseSchema.safeParse({
      query: 'github',
      events: [{ nonsense: true }],
      screenshots: [],
      activities: [],
      analyses: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a populated analysis hit', () => {
    const result = searchResponseSchema.safeParse({
      query: 'bug',
      events: [],
      screenshots: [],
      activities: [],
      analyses: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          screenshotId: 'b0000000-0000-4000-8000-000000000001',
          sessionId: SESSION_ID,
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          createdAt: '2026-08-07T10:06:00.000Z',
          page: {
            pageType: 'github_issue',
            category: 'development',
            purpose: 'Investigating a reported bug.',
            importantElements: [],
          },
          activity: {
            userIntent: 'Understand the bug',
            currentTask: 'Investigating a routing bug',
            activityCategory: 'development',
            summary: 'Reading a GitHub issue.',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
