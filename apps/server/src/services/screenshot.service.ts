import { SCREENSHOT_LIMITS } from '@vab/types';
import type {
  ListScreenshotsQuery,
  Screenshot,
  UploadScreenshotRequest,
  UploadScreenshotResponse,
} from '@vab/types';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { Repositories } from '../repositories/types.js';
import type { VisualRepositories } from '../repositories/visual-types.js';
import { screenshotPath } from '../storage/object-store.js';
import type { ObjectStore } from '../storage/object-store.js';

/**
 * Storing and serving screenshots.
 *
 * The bytes go to object storage and the metadata to PostgreSQL, which is the
 * split the specification asks for: a few hundred kilobytes per row would make
 * every query that never wanted the image pay for it.
 */

const CONTENT_TYPES: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png' };

export class ScreenshotService {
  constructor(
    private readonly repositories: Repositories,
    private readonly visual: VisualRepositories,
    private readonly store: ObjectStore,
  ) {}

  async upload(request: UploadScreenshotRequest): Promise<UploadScreenshotResponse> {
    const bytes = decodeBase64(request.imageBase64);

    // Re-checked here rather than trusted to the extension: the client-side
    // limit stops the traffic being generated, this one stops a modified client
    // from bypassing it.
    if (bytes.byteLength > SCREENSHOT_LIMITS.maxBytes) {
      throw new ValidationError(
        `Screenshot is ${String(bytes.byteLength)} bytes, over the ${String(SCREENSHOT_LIMITS.maxBytes)} byte limit.`,
      );
    }

    const userId = await this.repositories.users.ensure(request.installationId);

    // The session must exist before a screenshot can reference it. A capture can
    // legitimately arrive before the event batch that would have created it,
    // since the two travel on separate paths.
    await this.repositories.sessions.upsertMany(userId, [
      { id: request.sessionId, startedAt: request.capturedAt },
    ]);

    const path = screenshotPath(request.screenshotId, request.capturedAt, request.format);

    // Bytes first: a stored row pointing at a missing object is worse than an
    // orphaned object, which is invisible and reclaimable.
    await this.store.put(path, bytes, CONTENT_TYPES[request.format] ?? 'application/octet-stream');

    const { inserted } = await this.visual.screenshots.insert(userId, {
      id: request.screenshotId,
      sessionId: request.sessionId,
      storageBucket: this.store.bucket,
      storagePath: path,
      capturedAt: request.capturedAt,
      format: request.format,
      width: request.width,
      height: request.height,
      byteSize: bytes.byteLength,
      trigger: request.trigger,
      pageUrl: request.pageUrl,
      domain: request.domain,
      pageTitle: request.pageTitle,
      browserTabId: request.tabId,
    });

    return { screenshotId: request.screenshotId, stored: inserted, analysisStatus: 'pending' };
  }

  /** The image bytes, for the route that serves them to the dashboard. */
  async readImage(id: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const location = await this.visual.screenshots.findStorageLocation(id);
    if (!location) throw new NotFoundError(`No screenshot with id ${id}.`);

    const bytes = await this.store.get(location.path);
    const contentType = location.path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { bytes, contentType };
  }

  list(query: ListScreenshotsQuery): Promise<{ screenshots: Screenshot[]; total: number }> {
    // Unscoped for the same reason as the event and session reads; see
    // ARCHITECTURE.md.
    return this.visual.screenshots.list(null, {
      sessionId: query.sessionId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }
}

/**
 * Decodes base64, rejecting anything that is not valid.
 *
 * Node's decoder silently ignores invalid characters, so a corrupted or
 * malicious payload would otherwise be stored as a truncated image and only fail
 * later, inside the analysis worker, where the cause is much harder to see.
 */
export function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ValidationError('The image is not valid base64.');
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}
