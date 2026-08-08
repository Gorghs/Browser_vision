import { rm } from 'node:fs/promises';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
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

function anUpload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    installationId: INSTALLATION_ID,
    sessionId: SESSION_ID,
    screenshotId: crypto.randomUUID(),
    capturedAt: '2026-08-07T10:00:00.000Z',
    format: 'jpeg',
    imageBase64: TINY_JPEG_BASE64,
    width: 1920,
    height: 1080,
    trigger: 'manual',
    pageUrl: 'https://github.com/vercel/next.js',
    domain: 'github.com',
    pageTitle: 'Next.js',
    ...overrides,
  };
}

describe('GET /api/analytics/summary', () => {
  it('returns zeroed totals when nothing has been recorded', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/analytics/summary');

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      totals: {
        events: 0,
        sessions: 0,
        liveSessions: 0,
        screenshots: 0,
        analysedScreenshots: 0,
      },
      topDomains: [],
      categories: [],
    });
  });

  it('counts events and sessions, ranked domains and screenshots', async () => {
    const { app, persistence } = createApp();

    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent({ domain: 'github.com' }), anEvent({ domain: 'github.com' })]));
    const upload = anUpload();
    await request(app).post('/api/screenshots').send(upload);
    const screenshotId = String(upload.screenshotId);
    await persistence.visual.screenshots.setStatus(screenshotId, 'completed');

    const response = await request(app).get('/api/analytics/summary');

    expect(response.body.summary.totals).toEqual({
      events: 2,
      sessions: 1,
      liveSessions: 1,
      screenshots: 1,
      analysedScreenshots: 1,
    });
    expect(response.body.summary.topDomains).toEqual([{ domain: 'github.com', events: 2 }]);
  });

  it('ranks domains by event count, most active first', async () => {
    const { app } = createApp();

    await request(app)
      .post('/api/events')
      .send(
        aBatch([
          anEvent({ domain: 'example.com' }),
          anEvent({ domain: 'example.com' }),
          anEvent({ domain: 'github.com' }),
          anEvent({ domain: 'zod.dev' }),
          anEvent({ domain: 'zod.dev' }),
          anEvent({ domain: 'zod.dev' }),
        ]),
      );

    const response = await request(app).get('/api/analytics/summary');

    expect(response.body.summary.topDomains).toEqual([
      { domain: 'zod.dev', events: 3 },
      { domain: 'example.com', events: 2 },
      { domain: 'github.com', events: 1 },
    ]);
  });
});
