import type {
  IngestEventsRequest,
  IngestEventsResponse,
  UploadScreenshotRequest,
  UploadScreenshotResponse,
} from '@vab/types';
import type { ExtensionSettings } from '../services/settings.js';

/**
 * A failure worth trying again: the network was unreachable, the backend was
 * down, or it asked us to slow down. The events are still good.
 */
export class RetryableDeliveryError extends Error {
  constructor(
    message: string,
    /** Seconds the server asked us to wait, from `Retry-After`. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RetryableDeliveryError';
  }
}

/**
 * A failure that retrying cannot fix: the batch was rejected as malformed, or
 * the API key is wrong. Resending the same bytes would fail identically, so the
 * queue drops the batch rather than blocking every event behind it forever.
 */
export class PermanentDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

export type DeliveryPayload = IngestEventsRequest;

/** How long a single ingest request may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Screenshots are two orders of magnitude larger, so they get longer. */
const UPLOAD_TIMEOUT_MS = 45_000;

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Sends event batches to the backend.
 *
 * Reads settings on every call rather than caching them, so changing the
 * backend URL or API key in the popup takes effect on the next flush instead of
 * requiring an extension reload.
 */
export class BackendClient {
  constructor(private readonly getSettings: () => Promise<ExtensionSettings>) {}

  ingest(payload: DeliveryPayload): Promise<IngestEventsResponse> {
    return this.post<IngestEventsResponse>('/api/events', payload, REQUEST_TIMEOUT_MS);
  }

  uploadScreenshot(payload: UploadScreenshotRequest): Promise<UploadScreenshotResponse> {
    return this.post<UploadScreenshotResponse>('/api/screenshots', payload, UPLOAD_TIMEOUT_MS);
  }

  private async post<T>(path: string, payload: unknown, timeoutMs: number): Promise<T> {
    const settings = await this.getSettings();
    const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new PermanentDeliveryError('No backend URL is configured.', 0);
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      // Offline, DNS failure, connection refused, timeout: all worth retrying.
      const detail = cause instanceof Error ? cause.message : 'unknown network error';
      throw new RetryableDeliveryError(`Could not reach ${baseUrl}: ${detail}`);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await response.text().catch(() => '');
    const summary = `${String(response.status)} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`;

    // 429 and 5xx are transient by definition. Everything else means this
    // request will never be accepted in its current form.
    if (response.status === 429 || response.status >= 500) {
      throw new RetryableDeliveryError(
        summary,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    throw new PermanentDeliveryError(summary, response.status);
  }
}
