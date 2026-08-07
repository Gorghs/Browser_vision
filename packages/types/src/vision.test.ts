import { describe, expect, it } from 'vitest';
import { uploadScreenshotRequestSchema } from './screenshot.js';
import { visionAnalysisSchema } from './vision.js';

const validAnalysis = {
  page: {
    pageType: 'github_issue',
    category: 'development',
    purpose: 'Reading a bug report about router cache invalidation',
    importantElements: ['issue title', 'reproduction steps', 'comment thread'],
  },
  activity: {
    userIntent: 'Understand why the router cache is not invalidating',
    currentTask: 'Investigating a Next.js caching bug',
    activityCategory: 'development',
    summary: 'Reading a GitHub issue about Next.js router caching',
  },
};

describe('visionAnalysisSchema', () => {
  it('accepts a well-formed model response', () => {
    expect(visionAnalysisSchema.parse(validAnalysis).page.pageType).toBe('github_issue');
  });

  it('defaults importantElements so consumers never see undefined', () => {
    const { importantElements: _dropped, ...page } = validAnalysis.page;

    const parsed = visionAnalysisSchema.parse({ ...validAnalysis, page });

    expect(parsed.page.importantElements).toEqual([]);
  });

  it('rejects a category the model invented', () => {
    const invalid = {
      ...validAnalysis,
      page: { ...validAnalysis.page, category: 'vibes' },
    };

    expect(visionAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a response missing the activity half', () => {
    expect(visionAnalysisSchema.safeParse({ page: validAnalysis.page }).success).toBe(false);
  });

  it('rejects an empty summary, which tells a reader nothing', () => {
    const invalid = {
      ...validAnalysis,
      activity: { ...validAnalysis.activity, summary: '' },
    };

    expect(visionAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a model that writes an essay instead of a summary', () => {
    const invalid = {
      ...validAnalysis,
      activity: { ...validAnalysis.activity, summary: 'x'.repeat(5000) },
    };

    expect(visionAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a confidence outside 0 to 1', () => {
    const invalid = {
      ...validAnalysis,
      activity: { ...validAnalysis.activity, confidence: 42 },
    };

    expect(visionAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it('caps how many important elements are kept', () => {
    const invalid = {
      ...validAnalysis,
      page: { ...validAnalysis.page, importantElements: Array.from({ length: 30 }, () => 'x') },
    };

    expect(visionAnalysisSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('uploadScreenshotRequestSchema', () => {
  const valid = {
    installationId: '22222222-2222-4222-8222-222222222222',
    sessionId: '11111111-1111-4111-8111-111111111111',
    screenshotId: '44444444-4444-4444-8444-444444444444',
    capturedAt: '2026-08-07T10:00:00.000Z',
    format: 'jpeg',
    imageBase64: 'AAAA',
    width: 1920,
    height: 1080,
    trigger: 'navigation',
  };

  it('accepts a well-formed upload', () => {
    expect(uploadScreenshotRequestSchema.parse(valid).format).toBe('jpeg');
  });

  it('rejects an image format a vision model will not accept', () => {
    expect(uploadScreenshotRequestSchema.safeParse({ ...valid, format: 'bmp' }).success).toBe(
      false,
    );
  });

  it('rejects an empty image', () => {
    expect(uploadScreenshotRequestSchema.safeParse({ ...valid, imageBase64: '' }).success).toBe(
      false,
    );
  });

  it('rejects a trigger outside the capture policy', () => {
    expect(
      uploadScreenshotRequestSchema.safeParse({ ...valid, trigger: 'continuous' }).success,
    ).toBe(false);
  });

  it('requires a screenshot id, which is what makes upload idempotent', () => {
    const { screenshotId: _omitted, ...withoutId } = valid;

    expect(uploadScreenshotRequestSchema.safeParse(withoutId).success).toBe(false);
  });
});
