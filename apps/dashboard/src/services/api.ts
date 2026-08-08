import {
  analyticsSummaryResponseSchema,
  listEventsResponseSchema,
  listScreenshotsResponseSchema,
  listSessionsResponseSchema,
  listTimelineResponseSchema,
} from '@vab/types';
import type {
  AnalyticsSummaryResponse,
  AnalysisStatus,
  BrowserEventType,
  ListEventsResponse,
  ListScreenshotsResponse,
  ListSessionsResponse,
  ListTimelineResponse,
} from '@vab/types';

/**
 * The dashboard's only route to data.
 *
 * It talks to the REST API and never to Supabase: giving a browser page
 * database credentials would mean shipping a key that can read every user's
 * browsing history.
 *
 * Responses are validated with the same schemas the server validates against,
 * so a contract drift shows up as a clear error here rather than as a render
 * crash three components deep.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface EventQuery {
  type?: BrowserEventType | undefined;
  domain?: string | undefined;
  sessionId?: string | undefined;
  limit?: number;
}

async function get(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: API_KEY ? { 'x-api-key': API_KEY } : {},
    });
  } catch {
    throw new ApiError(`Could not reach the API at ${API_BASE_URL}. Is the server running?`);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: { message?: string } }).error.message)
        : `Request failed with ${String(response.status)}.`;
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<unknown>;
}

export async function fetchEvents(query: EventQuery = {}): Promise<ListEventsResponse> {
  const body = await get('/api/events', {
    type: query.type,
    domain: query.domain,
    sessionId: query.sessionId,
    limit: query.limit ?? 100,
  });

  const parsed = listEventsResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('The API returned events in an unexpected shape.');
  return parsed.data;
}

export async function fetchSessions(): Promise<ListSessionsResponse> {
  const body = await get('/api/sessions', { limit: 20 });

  const parsed = listSessionsResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('The API returned sessions in an unexpected shape.');
  return parsed.data;
}

export async function fetchAnalyticsSummary(): Promise<AnalyticsSummaryResponse> {
  const body = await get('/api/analytics/summary', {});

  const parsed = analyticsSummaryResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('The API returned analytics in an unexpected shape.');
  return parsed.data;
}

export interface TimelineQuery {
  sessionId?: string | undefined;
  limit?: number;
}

export async function fetchTimeline(query: TimelineQuery = {}): Promise<ListTimelineResponse> {
  const body = await get('/api/timeline', {
    sessionId: query.sessionId,
    limit: query.limit ?? 50,
  });

  const parsed = listTimelineResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('The API returned timeline data in an unexpected shape.');
  return parsed.data;
}

export interface ScreenshotsQuery {
  sessionId?: string | undefined;
  status?: AnalysisStatus | undefined;
  limit?: number;
  offset?: number;
}

export async function fetchScreenshots(
  query: ScreenshotsQuery = {},
): Promise<ListScreenshotsResponse> {
  const body = await get('/api/screenshots', {
    sessionId: query.sessionId,
    status: query.status,
    limit: query.limit ?? 30,
    offset: query.offset,
  });

  const parsed = listScreenshotsResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('The API returned screenshots in an unexpected shape.');
  return parsed.data;
}

/**
 * Loads a screenshot's bytes and hands back a URL the page can display.
 *
 * A plain `<img src>` cannot carry the `x-api-key` header the image route
 * requires once the API is protected, so the bytes are fetched through the same
 * authenticated path as everything else and made viewable as an object URL.
 * The caller must not depend on the URL once it is revoked, so this is used by
 * a component that owns the URL's lifetime.
 */
export async function fetchScreenshotImage(id: string): Promise<string> {
  const url = `${API_BASE_URL}/api/screenshots/${id}/image`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: API_KEY ? { 'x-api-key': API_KEY } : {},
    });
  } catch {
    throw new ApiError('Could not reach the API to load the screenshot image.');
  }

  if (!response.ok) {
    throw new ApiError(
      `Loading the screenshot failed with ${String(response.status)}.`,
      response.status,
    );
  }

  return URL.createObjectURL(await response.blob());
}
