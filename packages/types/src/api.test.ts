import { describe, expect, it } from 'vitest';
import { ingestEventsRequestSchema, listEventsQuerySchema } from './api.js';
import { EVENT_LIMITS, browserEventSchema } from './events.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const installationId = '22222222-2222-4222-8222-222222222222';

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sessionId,
    type: 'PAGE_LOADED',
    timestamp: '2026-08-07T10:00:00.000Z',
    url: 'https://example.com/docs',
    domain: 'example.com',
    ...overrides,
  };
}

describe('browserEventSchema', () => {
  it('defaults metadata to an empty object so consumers never see undefined', () => {
    const parsed = browserEventSchema.parse(validEvent());
    expect(parsed.metadata).toEqual({});
  });

  it('rejects an unknown event type', () => {
    expect(browserEventSchema.safeParse(validEvent({ type: 'KEYSTROKE' })).success).toBe(false);
  });

  it('rejects a timestamp without a timezone offset', () => {
    expect(
      browserEventSchema.safeParse(validEvent({ timestamp: '2026-08-07T10:00:00' })).success,
    ).toBe(false);
  });

  it('rejects a url longer than the limit', () => {
    const url = `https://example.com/${'a'.repeat(EVENT_LIMITS.urlMaxLength)}`;
    expect(browserEventSchema.safeParse(validEvent({ url })).success).toBe(false);
  });

  it('allows events with no url, such as session lifecycle events', () => {
    const parsed = browserEventSchema.parse({
      id: '44444444-4444-4444-8444-444444444444',
      sessionId,
      type: 'SESSION_STARTED',
      timestamp: '2026-08-07T10:00:00.000Z',
    });
    expect(parsed.url).toBeUndefined();
  });
});

describe('ingestEventsRequestSchema', () => {
  const session = { id: sessionId, startedAt: '2026-08-07T09:59:00.000Z' };

  it('accepts a well-formed batch', () => {
    const parsed = ingestEventsRequestSchema.parse({
      installationId,
      session,
      events: [validEvent()],
    });
    expect(parsed.events).toHaveLength(1);
  });

  it('rejects an empty batch, which would be a pointless request', () => {
    expect(
      ingestEventsRequestSchema.safeParse({ installationId, session, events: [] }).success,
    ).toBe(false);
  });

  it('rejects a batch over the size limit', () => {
    const events = Array.from({ length: EVENT_LIMITS.batchMaxSize + 1 }, () => validEvent());
    expect(ingestEventsRequestSchema.safeParse({ installationId, session, events }).success).toBe(
      false,
    );
  });

  it('rejects an installation id that is not a uuid', () => {
    expect(
      ingestEventsRequestSchema.safeParse({
        installationId: 'anonymous',
        session,
        events: [validEvent()],
      }).success,
    ).toBe(false);
  });
});

describe('listEventsQuerySchema', () => {
  it('coerces numeric strings from the query string', () => {
    expect(listEventsQuerySchema.parse({ limit: '25', offset: '50' })).toMatchObject({
      limit: 25,
      offset: 50,
    });
  });

  it('applies defaults when the client sends nothing', () => {
    expect(listEventsQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('caps limit so one request cannot ask for the whole table', () => {
    expect(listEventsQuerySchema.safeParse({ limit: '5000' }).success).toBe(false);
  });
});
