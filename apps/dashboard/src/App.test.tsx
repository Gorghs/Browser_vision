// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const TIMELINE = {
  activities: [
    {
      id: 'b0000000-0000-4000-8000-000000000001',
      sessionId: SESSION_ID,
      startedAt: '2026-08-07T10:00:00.000Z',
      endedAt: '2026-08-07T10:20:00.000Z',
      title: 'Investigating a Next.js routing issue',
      description: 'Read the GitHub issue thread and the linked documentation.',
      category: 'development',
      domains: ['github.com', 'nextjs.org'],
      eventCount: 24,
      source: 'ai',
    },
  ],
};

const SCREENSHOTS = {
  screenshots: [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      sessionId: SESSION_ID,
      capturedAt: '2026-08-07T10:05:00.000Z',
      format: 'jpeg',
      width: 1920,
      height: 1080,
      byteSize: 123456,
      trigger: 'navigation',
      pageUrl: 'https://github.com/vercel/next.js/issues/58123',
      domain: 'github.com',
      pageTitle: 'Router cache not invalidating',
      analysisStatus: 'completed',
      analysisError: null,
      ocr: {
        text: 'Router cache not invalidating',
        wordCount: 4,
        meanConfidence: 0.92,
        engine: 'tesseract.js',
        durationMs: 810,
      },
      analysis: {
        id: 'd0000000-0000-4000-8000-000000000001',
        screenshotId: 'c0000000-0000-4000-8000-000000000001',
        sessionId: SESSION_ID,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        createdAt: '2026-08-07T10:06:00.000Z',
        page: {
          pageType: 'github_issue',
          category: 'development',
          purpose: 'Discussing a bug report for a software library.',
          importantElements: ['issue title', 'description', 'comments'],
        },
        activity: {
          userIntent: 'To understand a reported routing bug.',
          currentTask: 'Investigating a Next.js routing issue',
          activityCategory: 'development',
          summary: 'Reading a GitHub issue about router cache invalidation.',
          confidence: 0.85,
        },
      },
    },
  ],
  total: 1,
};

function stubFetch(handler: (url: string) => { status?: number; body?: unknown; image?: boolean }) {
  const spy = vi.fn((input: string | URL) => {
    const url = String(input);
    const { status = 200, body, image = false } = handler(url);
    if (image) {
      return Promise.resolve({
        ok: status < 400,
        status,
        blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/jpeg' })),
      } as Response);
    }
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Routes every endpoint the dashboard touches to its fixture. */
function defaultHandler(url: string) {
  if (url.endsWith('/image')) return { image: true };
  if (url.includes('/api/timeline')) return { body: TIMELINE };
  if (url.includes('/api/screenshots')) return { body: SCREENSHOTS };
  if (url.includes('/api/sessions')) return { body: SESSIONS };
  return { body: EVENTS };
}

beforeEach(() => {
  // Zustand stores are module-level singletons; reset between tests.
  useActivityStore.setState({
    events: [],
    sessions: [],
    total: 0,
    activities: [],
    screenshots: [],
    screenshotTotal: 0,
    filters: { type: undefined, domain: '', sessionId: undefined },
    view: 'events',
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
    stubFetch(defaultHandler);

    render(<App />);

    expect(await screen.findByText('github.com')).toBeTruthy();
    expect(screen.getByText('/vercel/next.js/issues/58123')).toBeTruthy();
  });

  it('humanizes the event type rather than showing the raw constant', async () => {
    stubFetch(defaultHandler);

    render(<App />);

    expect(await screen.findByText('Session started')).toBeTruthy();
  });

  it('shows the page title beneath the path', async () => {
    stubFetch(defaultHandler);

    render(<App />);

    expect(await screen.findByText('Router cache not invalidating')).toBeTruthy();
  });

  it('reports the total event count', async () => {
    stubFetch(defaultHandler);

    render(<App />);

    expect(await screen.findByText('2 events recorded')).toBeTruthy();
  });

  it('lists sessions with their event counts', async () => {
    stubFetch(defaultHandler);

    render(<App />);

    expect(await screen.findByText('2 events')).toBeTruthy();
  });

  it('reads through the REST API rather than a database', async () => {
    const spy = stubFetch(defaultHandler);

    render(<App />);
    await screen.findByText('github.com');

    const called = spy.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes('/api/events'))).toBe(true);
    expect(called.some((url) => url.includes('supabase'))).toBe(false);
  });
});

describe('empty and error states', () => {
  it('explains what to do when nothing has been recorded', async () => {
    stubFetch((url) => {
      if (url.includes('/api/timeline')) return { body: { activities: [] } };
      if (url.includes('/api/screenshots')) return { body: { screenshots: [], total: 0 } };
      return { body: url.includes('/sessions') ? { sessions: [] } : { events: [], total: 0 } };
    });

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
    stubFetch((url) => {
      if (url.includes('/api/timeline')) return { body: { activities: [] } };
      if (url.includes('/api/screenshots')) return { body: { screenshots: [], total: 0 } };
      return {
        body: url.includes('/sessions') ? SESSIONS : { events: [{ nonsense: true }], total: 1 },
      };
    });

    render(<App />);

    expect(await screen.findByText(/unexpected shape/)).toBeTruthy();
  });
});

describe('filters', () => {
  it('sends the selected event type to the API', async () => {
    const spy = stubFetch(defaultHandler);
    render(<App />);
    await screen.findByText('github.com');

    useActivityStore.getState().setFilter('type', 'CLICK');

    await waitFor(() => {
      const called = spy.mock.calls.map((call) => String(call[0]));
      expect(called.some((url) => url.includes('type=CLICK'))).toBe(true);
    });
  });

  it('sends a selected session to the API', async () => {
    const spy = stubFetch(defaultHandler);
    render(<App />);
    await screen.findByText('github.com');

    useActivityStore.getState().setFilter('sessionId', SESSION_ID);

    await waitFor(() => {
      const called = spy.mock.calls.map((call) => String(call[0]));
      expect(called.some((url) => url.includes(`sessionId=${SESSION_ID}`))).toBe(true);
    });
  });

  it('omits an empty domain filter from the query', async () => {
    const spy = stubFetch(defaultHandler);

    render(<App />);
    await screen.findByText('github.com');

    const eventCalls = spy.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/events'));
    expect(eventCalls.every((url) => !url.includes('domain='))).toBe(true);
  });
});

describe('timeline view', () => {
  it('shows activities returned by the API', async () => {
    stubFetch(defaultHandler);
    render(<App />);
    await screen.findByText('github.com');

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));

    expect(await screen.findByText('Investigating a Next.js routing issue')).toBeTruthy();
    expect(screen.getByText(/Read the GitHub issue thread/)).toBeTruthy();
    expect(screen.getByText('Development')).toBeTruthy();
    expect(screen.getByText('AI understanding')).toBeTruthy();
    expect(screen.getByText('github.com')).toBeTruthy();
    expect(screen.getByText('24 events')).toBeTruthy();
  });

  it('labels activities assembled from events rather than claiming AI', async () => {
    stubFetch((url) => {
      if (url.includes('/api/timeline')) {
        return {
          body: {
            activities: [
              {
                id: 'b0000000-0000-4000-8000-000000000002',
                sessionId: SESSION_ID,
                startedAt: '2026-08-07T09:00:00.000Z',
                endedAt: '2026-08-07T09:10:00.000Z',
                title: 'example.com',
                description: '12 events, 3 pages',
                category: 'other',
                domains: ['example.com'],
                eventCount: 12,
                source: 'derived',
              },
            ],
          },
        };
      }
      if (url.includes('/api/screenshots')) return { body: { screenshots: [], total: 0 } };
      if (url.includes('/api/sessions')) return { body: SESSIONS };
      return { body: { events: [], total: 0 } };
    });
    render(<App />);
    await screen.findByText('0 events recorded');

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));

    expect(await screen.findByText('Derived from events')).toBeTruthy();
    expect(screen.queryByText('AI understanding')).toBeNull();
  });

  it('explains when no activities have been generated', async () => {
    stubFetch((url) => {
      if (url.includes('/api/timeline')) return { body: { activities: [] } };
      if (url.includes('/api/screenshots')) return { body: { screenshots: [], total: 0 } };
      if (url.includes('/api/sessions')) return { body: SESSIONS };
      return { body: { events: [], total: 0 } };
    });
    render(<App />);
    await screen.findByText('0 events recorded');

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));

    expect(await screen.findByText(/No timeline activities yet/)).toBeTruthy();
  });
});

describe('screenshots view', () => {
  it('shows the image, OCR text and AI understanding', async () => {
    stubFetch(defaultHandler);
    render(<App />);
    await screen.findByText('github.com');

    fireEvent.click(screen.getByRole('button', { name: 'Screenshots' }));

    expect(await screen.findByText('1 capture recorded')).toBeTruthy();
    expect(screen.getByText('OCR text')).toBeTruthy();
    expect(screen.getByText('4 words · 92% confidence · tesseract.js')).toBeTruthy();
    expect(screen.getByText('AI understanding')).toBeTruthy();
    expect(
      screen.getByText('Reading a GitHub issue about router cache invalidation.'),
    ).toBeTruthy();
    expect(screen.getByText('github_issue')).toBeTruthy();
    expect(screen.getByText('To understand a reported routing bug.')).toBeTruthy();
  });

  it('requests the image bytes through the authenticated API path', async () => {
    const spy = stubFetch(defaultHandler);
    render(<App />);
    await screen.findByText('github.com');

    fireEvent.click(screen.getByRole('button', { name: 'Screenshots' }));
    await screen.findByText('OCR text');

    await waitFor(() => {
      const imageCalls = spy.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/image'));
      expect(imageCalls).toHaveLength(1);
      expect(imageCalls[0]).toContain(
        '/api/screenshots/c0000000-0000-4000-8000-000000000001/image',
      );
    });
  });

  it('shows a pending capture waiting for the pipeline', async () => {
    stubFetch((url) => {
      if (url.endsWith('/image')) return { image: true };
      if (url.includes('/api/screenshots')) {
        return {
          body: {
            screenshots: [
              {
                id: 'c0000000-0000-4000-8000-000000000002',
                sessionId: SESSION_ID,
                capturedAt: '2026-08-07T10:05:00.000Z',
                format: 'jpeg',
                width: 1920,
                height: 1080,
                byteSize: 123456,
                trigger: 'navigation',
                pageUrl: 'https://github.com/vercel/next.js',
                domain: 'github.com',
                pageTitle: 'Next.js',
                analysisStatus: 'pending',
                analysisError: null,
                ocr: null,
                analysis: null,
              },
            ],
            total: 1,
          },
        };
      }
      if (url.includes('/api/timeline')) return { body: { activities: [] } };
      if (url.includes('/api/sessions')) return { body: SESSIONS };
      return { body: { events: [], total: 0 } };
    });
    render(<App />);
    await screen.findByText('0 events recorded');

    fireEvent.click(screen.getByRole('button', { name: 'Screenshots' }));

    expect(await screen.findByText('Waiting to be analysed')).toBeTruthy();
    expect(screen.getByText(/OCR and AI understanding appear here/)).toBeTruthy();
  });

  it('explains when nothing has been captured', async () => {
    stubFetch((url) => {
      if (url.includes('/api/screenshots')) return { body: { screenshots: [], total: 0 } };
      if (url.includes('/api/timeline')) return { body: { activities: [] } };
      if (url.includes('/api/sessions')) return { body: SESSIONS };
      return { body: { events: [], total: 0 } };
    });
    render(<App />);
    await screen.findByText('0 events recorded');

    fireEvent.click(screen.getByRole('button', { name: 'Screenshots' }));

    expect(await screen.findByText(/No screenshots yet/)).toBeTruthy();
  });
});

describe('view switching', () => {
  it('starts on the events view', async () => {
    stubFetch(defaultHandler);
    render(<App />);

    expect(await screen.findByText('/vercel/next.js/issues/58123')).toBeTruthy();
    expect(screen.queryByText('Recent timeline')).toBeNull();
  });

  it('switches between all three views', async () => {
    stubFetch(defaultHandler);
    render(<App />);
    await screen.findByText('github.com');

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByText('Recent timeline')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Screenshots' }));
    expect(await screen.findByText('Recent screenshots')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    expect(await screen.findByText('Recent events')).toBeTruthy();
  });
});
