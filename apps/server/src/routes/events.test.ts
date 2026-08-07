import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { INSTALLATION_ID, SESSION_ID, aBatch, anEvent, createTestApp } from '../testing/harness.js';

describe('POST /api/events', () => {
  it('accepts a valid batch', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/events')
      .send(aBatch([anEvent(), anEvent()]));

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: 2, duplicates: 0 });
  });

  it('stores the events so they can be read back', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent({ domain: 'github.com' })]));

    const response = await request(app).get('/api/events');

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({ domain: 'github.com', type: 'PAGE_LOADED' });
  });

  it('creates the session implied by the events', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent()]));

    const response = await request(app).get('/api/sessions');

    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0]).toMatchObject({ id: SESSION_ID, eventCount: 1 });
  });

  it('treats a re-sent batch as duplicates rather than an error', async () => {
    const { app } = createTestApp();
    const batch = aBatch([anEvent(), anEvent()]);

    await request(app).post('/api/events').send(batch);
    const response = await request(app).post('/api/events').send(batch);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: 0, duplicates: 2 });
  });

  it('does not store a re-sent event twice', async () => {
    const { app } = createTestApp();
    const batch = aBatch([anEvent()]);

    await request(app).post('/api/events').send(batch);
    await request(app).post('/api/events').send(batch);
    const response = await request(app).get('/api/events');

    expect(response.body.total).toBe(1);
  });

  it('accepts a batch spanning two sessions', async () => {
    const { app } = createTestApp();
    const other = '99999999-9999-4999-8999-999999999999';

    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent(), anEvent({ sessionId: other })]));
    const response = await request(app).get('/api/sessions');

    expect(response.body.sessions).toHaveLength(2);
  });
});

describe('POST /api/events validation', () => {
  it('rejects an unknown event type', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/events')
      .send(aBatch([anEvent({ type: 'KEYSTROKE' })]));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reports which field was wrong', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/events')
      .send(aBatch([anEvent({ timestamp: 'yesterday' })]));

    expect(JSON.stringify(response.body.error.details)).toContain('timestamp');
  });

  it('rejects an empty batch', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/api/events').send(aBatch([]));

    expect(response.status).toBe(400);
  });

  it('rejects a batch over the size limit', async () => {
    const { app } = createTestApp();
    const events = Array.from({ length: 201 }, () => anEvent());

    const response = await request(app).post('/api/events').send(aBatch(events));

    expect(response.status).toBe(400);
  });

  it('rejects a missing installation id', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/events')
      .send({ events: [anEvent()] });

    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with a 400 rather than a 500', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/events')
      .set('content-type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a body far larger than any legitimate batch', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/events')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ installationId: INSTALLATION_ID, padding: 'x'.repeat(2_000_000) }));

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/events', () => {
  async function seed(app: Parameters<typeof request>[0]) {
    await request(app)
      .post('/api/events')
      .send(
        aBatch([
          anEvent({ domain: 'github.com', type: 'PAGE_LOADED' }),
          anEvent({ domain: 'github.com', type: 'CLICK' }),
          anEvent({ domain: 'developer.mozilla.org', type: 'PAGE_LOADED' }),
        ]),
      );
  }

  it('returns the newest events first', async () => {
    const { app } = createTestApp();
    await seed(app);

    const response = await request(app).get('/api/events');

    const timestamps = response.body.events.map((event: { timestamp: string }) => event.timestamp);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
  });

  it('filters by domain', async () => {
    const { app } = createTestApp();
    await seed(app);

    const response = await request(app).get('/api/events?domain=github.com');

    expect(response.body.events).toHaveLength(2);
    expect(response.body.total).toBe(2);
  });

  it('filters by event type', async () => {
    const { app } = createTestApp();
    await seed(app);

    const response = await request(app).get('/api/events?type=CLICK');

    expect(response.body.events).toHaveLength(1);
  });

  it('filters by session', async () => {
    const { app } = createTestApp();
    await seed(app);
    const other = '99999999-9999-4999-8999-999999999999';
    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent({ sessionId: other })]));

    const response = await request(app).get(`/api/events?sessionId=${other}`);

    expect(response.body.events).toHaveLength(1);
  });

  it('paginates, reporting the unpaginated total', async () => {
    const { app } = createTestApp();
    await seed(app);

    const response = await request(app).get('/api/events?limit=2&offset=0');

    expect(response.body.events).toHaveLength(2);
    expect(response.body.total).toBe(3);
  });

  it('returns the next page', async () => {
    const { app } = createTestApp();
    await seed(app);

    const first = await request(app).get('/api/events?limit=2&offset=0');
    const second = await request(app).get('/api/events?limit=2&offset=2');

    expect(second.body.events).toHaveLength(1);
    expect(second.body.events[0].id).not.toBe(first.body.events[0].id);
  });

  it('rejects a limit above the cap rather than honouring it', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/events?limit=100000');

    expect(response.status).toBe(400);
  });

  it('rejects an unknown event type filter', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/events?type=NONSENSE');

    expect(response.status).toBe(400);
  });
});

describe('GET /api/sessions', () => {
  it('returns an empty list before anything is ingested', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/sessions');

    expect(response.body).toEqual({ sessions: [] });
  });

  it('reports the event count and latest activity per session', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent(), anEvent(), anEvent()]));

    const response = await request(app).get('/api/sessions');

    expect(response.body.sessions[0]).toMatchObject({ eventCount: 3 });
    expect(response.body.sessions[0].lastEventAt).toBeTruthy();
  });

  it('closes a session that reported SESSION_ENDED', async () => {
    const { app } = createTestApp();
    const endedAt = '2026-08-07T11:00:00.000Z';

    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent(), anEvent({ type: 'SESSION_ENDED', timestamp: endedAt })]));
    const response = await request(app).get('/api/sessions');

    expect(response.body.sessions[0].endedAt).toBe(endedAt);
  });

  it('leaves a running session open', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/events')
      .send(aBatch([anEvent()]));

    const response = await request(app).get('/api/sessions');

    expect(response.body.sessions[0].endedAt).toBeUndefined();
  });
});
