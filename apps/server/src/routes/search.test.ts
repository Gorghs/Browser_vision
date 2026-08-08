import { rm } from 'node:fs/promises';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { VisionAnalysis } from '@vab/types';
import { INSTALLATION_ID, SESSION_ID, aBatch, anEvent, createTestApp } from '../testing/harness.js';

const directories: string[] = [];

function createApp() {
  const harness = createTestApp();
  directories.push(harness.config.screenshotDir);
  return harness;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

let uploadCounter = 0;
function anUpload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  uploadCounter += 1;
  return {
    installationId: INSTALLATION_ID,
    sessionId: SESSION_ID,
    screenshotId: `44444444-4444-4444-8444-${String(uploadCounter).padStart(12, '0')}`,
    capturedAt: '2026-08-07T10:00:00.000Z',
    format: 'jpeg',
    imageBase64: TINY_JPEG_BASE64,
    width: 1920,
    height: 1080,
    trigger: 'navigation',
    pageUrl: 'https://github.com/vercel/next.js/issues/58123',
    domain: 'github.com',
    pageTitle: 'Router cache not invalidating',
    ...overrides,
  };
}

function anAnalysis(): VisionAnalysis {
  return {
    page: {
      pageType: 'github_issue',
      category: 'development',
      purpose: 'Investigating a reported routing bug.',
      importantElements: ['issue title', 'comments'],
    },
    activity: {
      userIntent: 'Understand the routing bug.',
      currentTask: 'Investigating a Next.js routing issue',
      activityCategory: 'development',
      summary: 'Reading a GitHub issue about router cache invalidation.',
      confidence: 0.85,
    },
  };
}

/** Writes an analysis straight into the visual store, as the worker would. */
async function storeAnalysis(
  persistence: ReturnType<typeof createApp>['persistence'],
  screenshotId: string,
  analysis: VisionAnalysis,
): Promise<void> {
  await persistence.visual.analyses.insert({
    ...analysis,
    screenshotId,
    sessionId: SESSION_ID,
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    raw: {},
  });
}

describe('GET /api/search', () => {
  it('returns empty groups for a query with no matches', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/search').query({ q: 'nonexistent' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      query: 'nonexistent',
      events: [],
      screenshots: [],
      activities: [],
      analyses: [],
    });
  });

  it('finds events by domain keyword', async () => {
    const { app } = createApp();
    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent({ domain: 'github.com', url: 'https://github.com/vercel/next.js' })]));

    const response = await request(app).get('/api/search').query({ q: 'github' });

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({ domain: 'github.com' });
  });

  it('finds screenshots by OCR text', async () => {
    const { app, persistence } = createApp();
    const upload = anUpload();
    await request(app).post('/api/screenshots').send(upload);
    await persistence.visual.ocr.upsert(String(upload.screenshotId), {
      text: 'The router cache keeps stale entries',
      wordCount: 5,
      meanConfidence: 0.9,
      engine: 'tesseract.js',
      durationMs: 10,
    });

    const response = await request(app).get('/api/search').query({ q: 'stale entries' });

    expect(response.body.screenshots).toHaveLength(1);
    expect(response.body.screenshots[0]).toMatchObject({ id: upload.screenshotId });
  });

  it('finds screenshots by page title', async () => {
    const { app } = createApp();
    await request(app)
      .post('/api/screenshots')
      .send(anUpload({ pageTitle: 'Next.js Docs' }));

    const response = await request(app).get('/api/search').query({ q: 'Next.js' });

    expect(response.body.screenshots).toHaveLength(1);
  });

  it('finds analyses by AI summary text', async () => {
    const { app, persistence } = createApp();
    const upload = anUpload();
    await request(app).post('/api/screenshots').send(upload);
    await storeAnalysis(persistence, String(upload.screenshotId), anAnalysis());

    const response = await request(app).get('/api/search').query({ q: 'cache invalidation' });

    expect(response.body.analyses).toHaveLength(1);
    expect(response.body.analyses[0]).toMatchObject({
      screenshotId: upload.screenshotId,
      provider: 'gemini',
    });
  });

  it('scopes search to the selected session', async () => {
    const { app } = createApp();
    const otherSession = '99999999-9999-4999-8999-999999999999';
    await request(app)
      .post('/api/events')
      .send(
        aBatch([
          anEvent({ domain: 'github.com' }),
          anEvent({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: otherSession }),
        ]),
      );

    const response = await request(app)
      .get('/api/search')
      .query({ q: 'example.com', sessionId: SESSION_ID });

    expect(response.body.events).toHaveLength(1);
  });

  it('rejects a missing query', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/search');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
