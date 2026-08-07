// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useActivityStore } from './store/activity-store.js';

/**
 * Renders the real dashboard against a stubbed `fetch`.
 *
 * The store, the API client and its response validation all run for real; only
 * the network is substituted. That makes this an honest check that events
 * ingested by the API reach the screen.
 */

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const EVENTS = {
  events: [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      sessionId: SESSION_ID,
      type: 'NAVIGATION',
      timestamp: '2026-08-07T10:00:02.000Z',
      url: 'https://github.com/vercel/next.js/issues/58123',
      domain: 'github.com',
      title: 'Router cache not invalidating',
      metadata: {},
    },
    {
      id: 'a0000000-0000-4000-8000-000000000002',
      sessionId: SESSION_ID,
      type: 'SESSION_STARTED',
      timestamp: '2026-08-07T10:00:00.000Z',
      metadata: {},
    },
  ],
  total: 2,
};

const SESSIONS = {
  sessions: [
    {
      id: SESSION_ID,
      startedAt: '2026-08-07T10:00:00.000Z',
      endedAt: '2026-08-07T10:35:00.000Z',
      eventCount: 2,
      lastEventAt: '2026-08-07T10:00:02.000Z',
    },
  ],
};

function stubFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const spy = vi.fn((input: string | URL) => {
    const url = String(input);
    const { status = 200, body } = handler(url);
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  // Zustand stores are module-level singletons; reset between tests.
  useActivityStore.setState({
    events: [],
    sessions: [],
    total: 0,
    filters: { type: undefined, domain: '', sessionId: undefined },
    loading: false,
    error: null,
    lastLoadedAt: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('rendering activity', () => {
  it('shows events returned by the API', async () => {
    stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);

    expect(await screen.findByText('github.com')).toBeTruthy();
    expect(screen.getByText('/vercel/next.js/issues/58123')).toBeTruthy();
  });

  it('humanizes the event type rather than showing the raw constant', async () => {
    stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);

    expect(await screen.findByText('Session started')).toBeTruthy();
  });

  it('shows the page title beneath the path', async () => {
    stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);

    expect(await screen.findByText('Router cache not invalidating')).toBeTruthy();
  });

  it('reports the total event count', async () => {
    stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);

    expect(await screen.findByText('2 events recorded')).toBeTruthy();
  });

  it('lists sessions with their event counts', async () => {
    stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);

    expect(await screen.findByText('2 events')).toBeTruthy();
  });

  it('reads through the REST API rather than a database', async () => {
    const spy = stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);
    await screen.findByText('github.com');

    const called = spy.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes('/api/events'))).toBe(true);
    expect(called.some((url) => url.includes('supabase'))).toBe(false);
  });
});

describe('empty and error states', () => {
  it('explains what to do when nothing has been recorded', async () => {
    stubFetch((url) => ({
      body: url.includes('/sessions') ? { sessions: [] } : { events: [], total: 0 },
    }));

    render(<App />);

    expect(await screen.findByText(/No events match these filters/)).toBeTruthy();
  });

  it('surfaces an unreachable API instead of rendering an empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('connection refused'))),
    );

    render(<App />);

    expect(await screen.findByText(/Could not reach the API/)).toBeTruthy();
  });

  it('surfaces an API error message', async () => {
    stubFetch(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'A valid API key is required.' } },
    }));

    render(<App />);

    expect(await screen.findByText('A valid API key is required.')).toBeTruthy();
  });

  it('rejects a response that does not match the shared schema', async () => {
    stubFetch((url) => ({
      body: url.includes('/sessions') ? SESSIONS : { events: [{ nonsense: true }], total: 1 },
    }));

    render(<App />);

    expect(await screen.findByText(/unexpected shape/)).toBeTruthy();
  });
});

describe('filters', () => {
  it('sends the selected event type to the API', async () => {
    const spy = stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));
    render(<App />);
    await screen.findByText('github.com');

    useActivityStore.getState().setFilter('type', 'CLICK');

    await waitFor(() => {
      const called = spy.mock.calls.map((call) => String(call[0]));
      expect(called.some((url) => url.includes('type=CLICK'))).toBe(true);
    });
  });

  it('sends a selected session to the API', async () => {
    const spy = stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));
    render(<App />);
    await screen.findByText('github.com');

    useActivityStore.getState().setFilter('sessionId', SESSION_ID);

    await waitFor(() => {
      const called = spy.mock.calls.map((call) => String(call[0]));
      expect(called.some((url) => url.includes(`sessionId=${SESSION_ID}`))).toBe(true);
    });
  });

  it('omits an empty domain filter from the query', async () => {
    const spy = stubFetch((url) => ({ body: url.includes('/sessions') ? SESSIONS : EVENTS }));

    render(<App />);
    await screen.findByText('github.com');

    const eventCalls = spy.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/events'));
    expect(eventCalls.every((url) => !url.includes('domain='))).toBe(true);
  });
});
