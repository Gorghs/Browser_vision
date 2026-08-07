import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { aBatch, anEvent, createTestApp } from '../testing/harness.js';

const API_KEY = 'a-sufficiently-long-test-key';

describe('with an API key configured', () => {
  it('rejects a request with no key', async () => {
    const { app } = createTestApp({ apiKey: API_KEY });

    const response = await request(app)
      .post('/api/events')
      .send(aBatch([anEvent()]));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong key', async () => {
    const { app } = createTestApp({ apiKey: API_KEY });

    const response = await request(app)
      .post('/api/events')
      .set('x-api-key', 'wrong-key-of-same-ish-len')
      .send(aBatch([anEvent()]));

    expect(response.status).toBe(401);
  });

  it('accepts the correct key', async () => {
    const { app } = createTestApp({ apiKey: API_KEY });

    const response = await request(app)
      .post('/api/events')
      .set('x-api-key', API_KEY)
      .send(aBatch([anEvent()]));

    expect(response.status).toBe(202);
  });

  it('protects reads as well as writes', async () => {
    const { app } = createTestApp({ apiKey: API_KEY });

    expect((await request(app).get('/api/events')).status).toBe(401);
    expect((await request(app).get('/api/sessions')).status).toBe(401);
  });

  it('leaves the health check reachable, so liveness probes still work', async () => {
    const { app } = createTestApp({ apiKey: API_KEY });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
  });

  it('does not reject a request merely for having a key of another length', async () => {
    const { app } = createTestApp({ apiKey: API_KEY });

    const response = await request(app).get('/api/events').set('x-api-key', 'short');

    expect(response.status).toBe(401);
  });
});

describe('with no API key configured', () => {
  it('allows requests, for local development', async () => {
    const { app } = createTestApp({ apiKey: undefined });

    const response = await request(app).get('/api/events');

    expect(response.status).toBe(200);
  });

  it('warns at startup that the API is unauthenticated', () => {
    const { logs } = createTestApp({ apiKey: undefined });

    expect(logs.join('\n')).toContain('unauthenticated');
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 rather than an HTML error page', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('health', () => {
  it('reports the storage backend in use', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/health');

    expect(response.body).toMatchObject({ status: 'ok', storage: 'memory' });
  });

  it('warns that in-memory data does not survive a restart', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/health');

    expect(response.body.warning).toContain('lost when the server restarts');
  });
});
