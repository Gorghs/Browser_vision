import { listEventsResponseSchema, listSessionsResponseSchema } from '@vab/types';
import type { BrowserEventType, ListEventsResponse, ListSessionsResponse } from '@vab/types';

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
