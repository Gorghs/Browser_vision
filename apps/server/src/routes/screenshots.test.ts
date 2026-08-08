import { rm } from 'node:fs/promises';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTALLATION_ID, SESSION_ID, createTestApp } from '../testing/harness.js';

/** A one-pixel JPEG, so the bytes travelling through are a real image. */
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const directories: string[] = [];

function createApp(overrides = {}) {
  const harness = createTestApp(overrides);
  directories.push(harness.config.screenshotDir);
  return harness;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

let screenshotCounter = 0;
function anUpload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  screenshotCounter += 1;
  return {
    installationId: INSTALLATION_ID,
    sessionId: SESSION_ID,
    screenshotId: `44444444-4444-4444-8444-${String(screenshotCounter).padStart(12, '0')}`,
    capturedAt: '2026-08-07T10:00:00.000Z',
    format: 'jpeg',
    imageBase64: TINY_JPEG_BASE64,
    width: 1920,
    height: 1080,
    trigger: 'navigation',
    pageUrl: 'https://github.com/vercel/next.js',
    domain: 'github.com',
    pageTitle: 'Next.js',
    ...overrides,
  };
}

describe('POST /api/screenshots', () => {
  it('accepts an upload', async () => {
    const { app } = createApp();

    const response = await request(app).post('/api/screenshots').send(anUpload());

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ stored: true, analysisStatus: 'pending' });
  });

  it('creates the session when the capture arrives before the event batch', async () => {
    // Screenshots and events travel on separate paths, so either can be first.
    const { app } = createApp();

    await request(app).post('/api/screenshots').send(anUpload());
    const sessions = await request(app).get('/api/sessions');

    expect(sessions.body.sessions).toHaveLength(1);
  });

  it('treats a re-sent upload as already stored rather than an error', async () => {
    const { app } = createApp();
    const upload = anUpload();

    await request(app).post('/api/screenshots').send(upload);
    const second = await request(app).post('/api/screenshots').send(upload);

    expect(second.status).toBe(202);
    expect(second.body.stored).toBe(false);
  });

  it('does not store a re-sent upload twice', async () => {
    const { app } = createApp();
    const upload = anUpload();

    await request(app).post('/api/screenshots').send(upload);
    await request(app).post('/api/screenshots').send(upload);
    const list = await request(app).get('/api/screenshots');

    expect(list.body.total).toBe(1);
  });

  it('records the decoded byte size, not the base64 length', async () => {
    const { app } = createApp();
    await request(app).post('/api/screenshots').send(anUpload());

    const list = await request(app).get('/api/screenshots');

    const stored = list.body.screenshots[0];
    expect(stored.byteSize).toBeLessThan(TINY_JPEG_BASE64.length);
    expect(stored.byteSize).toBeGreaterThan(0);
  });

  it('rejects an image that is not valid base64', async () => {
    const { app } = createApp();

    const response = await request(app)
      .post('/api/screenshots')
      .send(anUpload({ imageBase64: 'not!valid!base64!' }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown image format', async () => {
    const { app } = createApp();

    const response = await request(app)
      .post('/api/screenshots')
      .send(anUpload({ format: 'gif' }));

    expect(response.status).toBe(400);
  });

  it('rejects a capture with no session', async () => {
    const { app } = createApp();
    const { sessionId: _omitted, ...withoutSession } = anUpload();

    const response = await request(app).post('/api/screenshots').send(withoutSession);

    expect(response.status).toBe(400);
  });

  it('requires the API key when one is configured', async () => {
    const { app } = createApp({ apiKey: 'a-sufficiently-long-test-key' });

    const response = await request(app).post('/api/screenshots').send(anUpload());

    expect(response.status).toBe(401);
  });
});

describe('GET /api/screenshots', () => {
  it('returns an empty list before anything is uploaded', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/screenshots');

    expect(response.body).toEqual({ screenshots: [], total: 0 });
  });

  it('returns captures newest first', async () => {
    const { app } = createApp();
    await request(app)
      .post('/api/screenshots')
      .send(anUpload({ capturedAt: '2026-08-07T10:00:00.000Z' }));
    await request(app)
      .post('/api/screenshots')
      .send(anUpload({ capturedAt: '2026-08-07T11:00:00.000Z' }));

    const response = await request(app).get('/api/screenshots');

    expect(response.body.screenshots[0].capturedAt).toBe('2026-08-07T11:00:00.000Z');
  });

  it('reports a fresh capture as pending analysis', async () => {
    const { app } = createApp();
    await request(app).post('/api/screenshots').send(anUpload());

    const response = await request(app).get('/api/screenshots');

    expect(response.body.screenshots[0]).toMatchObject({
      analysisStatus: 'pending',
      ocr: null,
      analysis: null,
    });
  });

  it('filters by analysis status', async () => {
    const { app } = createApp();
    await request(app).post('/api/screenshots').send(anUpload());

    const pending = await request(app).get('/api/screenshots?status=pending');
    const completed = await request(app).get('/api/screenshots?status=completed');

    expect(pending.body.screenshots).toHaveLength(1);
    expect(completed.body.screenshots).toHaveLength(0);
  });

  it('filters by session', async () => {
    const { app } = createApp();
    const other = '99999999-9999-4999-8999-999999999999';
    await request(app).post('/api/screenshots').send(anUpload());
    await request(app)
      .post('/api/screenshots')
      .send(anUpload({ sessionId: other }));

    const response = await request(app).get(`/api/screenshots?sessionId=${other}`);

    expect(response.body.screenshots).toHaveLength(1);
  });

  it('rejects an unknown status filter', async () => {
    const { app } = createApp();

    expect((await request(app).get('/api/screenshots?status=nonsense')).status).toBe(400);
  });
});

describe('GET /api/screenshots/:id/image', () => {
  it('serves the bytes that were uploaded', async () => {
    const { app } = createApp();
    const upload = anUpload();
    await request(app).post('/api/screenshots').send(upload);

    const response = await request(app).get(
      `/api/screenshots/${String(upload.screenshotId)}/image`,
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(response.body).toString('base64')).toBe(TINY_JPEG_BASE64);
  });

  it('marks the image cacheable and private', async () => {
    const { app } = createApp();
    const upload = anUpload();
    await request(app).post('/api/screenshots').send(upload);

    const response = await request(app).get(
      `/api/screenshots/${String(upload.screenshotId)}/image`,
    );

    expect(response.headers['cache-control']).toContain('private');
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = createApp();

    const response = await request(app).get(
      '/api/screenshots/55555555-5555-4555-8555-555555555555/image',
    );

    expect(response.status).toBe(404);
  });

  it('rejects an id that is not a uuid rather than touching storage', async () => {
    const { app } = createApp();

    expect((await request(app).get('/api/screenshots/..%2F..%2Fetc/image')).status).toBe(400);
  });

  it('requires the API key when one is configured', async () => {
    const { app } = createApp({ apiKey: 'a-sufficiently-long-test-key' });

    const response = await request(app).get(
      '/api/screenshots/55555555-5555-4555-8555-555555555555/image',
    );

    expect(response.status).toBe(401);
  });
});

describe('GET /api/timeline', () => {
  it('returns an empty timeline before anything is analysed', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/timeline');

    expect(response.body).toEqual({ activities: [] });
  });

  it('rejects a limit above the cap', async () => {
    const { app } = createApp();

    expect((await request(app).get('/api/timeline?limit=100000')).status).toBe(400);
  });
});

describe('GET /health', () => {
  it('reports which optional capabilities are switched on', async () => {
    const { app } = createApp();

    const response = await request(app).get('/health');

    expect(response.body).toMatchObject({
      status: 'ok',
      imageStorage: 'filesystem',
      ai: 'disabled',
      ocr: 'disabled',
    });
  });

  it('names the AI provider when one is configured', async () => {
    const { app } = createApp({
      ai: {
        provider: 'gemini',
        apiKey: 'secret-key-value',
        model: undefined,
        baseUrl: undefined,
      },
    });

    const response = await request(app).get('/health');

    expect(response.body.ai).toBe('gemini');
    // The key must never be echoed back, even to an authenticated caller.
    expect(JSON.stringify(response.body)).not.toContain('secret-key-value');
  });
});
