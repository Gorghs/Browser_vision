import { SCREENSHOT_LIMITS, extractDomain, isTrackableUrl, sanitizeUrl } from '@vab/types';
import type { UploadScreenshotRequest } from '@vab/types';
import { isDomainBlocked } from '../services/settings.js';
import type { ExtensionSettings } from '../services/settings.js';
import type { CapturePolicy, CaptureTrigger } from './capture-policy.js';
import type { EventCollector } from './event-collector.js';
import type { SessionManager } from './session-manager.js';

/**
 * Takes screenshots and hands them to the backend.
 *
 * Captures are best-effort by design. Unlike events, a screenshot is hundreds of
 * kilobytes, and buffering several of them would exhaust the extension's storage
 * quota during a backend outage — the durable queue would then start dropping
 * telemetry to make room for images. So an upload is attempted once, retried
 * once, and otherwise abandoned with a reported reason.
 *
 * The SCREENSHOT_CAPTURED event is emitted only after a successful upload, which
 * keeps the events log free of references to screenshots that do not exist.
 */

export interface CaptureOutcome {
  captured: boolean;
  reason?: string;
  screenshotId?: string;
}

export interface ScreenshotUploader {
  upload(request: UploadScreenshotRequest): Promise<{ stored: boolean }>;
}

export interface ScreenshotEngineOptions {
  policy: CapturePolicy;
  sessions: SessionManager;
  collector: EventCollector;
  uploader: ScreenshotUploader;
  getSettings: () => Promise<ExtensionSettings>;
  getInstallationId: () => Promise<string>;
  /** Injected so tests need no Chrome. */
  captureTab: (windowId: number) => Promise<string>;
  hasCapturePermission: () => Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
  onError?: (message: string) => void;
}

/** Quality is a deliberate trade: legible to OCR, small enough to send often. */
export const CAPTURE_QUALITY = 60;

/** Splits `data:image/jpeg;base64,AAA` into its parts. */
export function parseDataUrl(dataUrl: string): { format: 'jpeg' | 'png'; base64: string } | null {
  const match = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;

  const [, rawFormat, base64] = match;
  if (rawFormat === undefined || base64 === undefined) return null;

  return { format: rawFormat === 'png' ? 'png' : 'jpeg', base64 };
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface CaptureContext {
  trigger: CaptureTrigger;
  tabId: number;
  windowId: number;
  url?: string | undefined;
  title?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export class ScreenshotEngine {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly options: ScreenshotEngineOptions) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async capture(context: CaptureContext): Promise<CaptureOutcome> {
    const settings = await this.options.getSettings();

    // Tracking off means nothing is collected at all, visual or otherwise.
    if (!settings.trackingEnabled) return { captured: false, reason: 'tracking-disabled' };

    // The same URL rules as every other event. A screenshot of a bank page is
    // exactly what the blocklist exists to prevent.
    if (!isTrackableUrl(context.url)) return { captured: false, reason: 'untrackable-url' };
    const domain = extractDomain(context.url);
    if (isDomainBlocked(domain, settings.blockedDomains)) {
      return { captured: false, reason: 'blocked-domain' };
    }

    const session = await this.options.sessions.current();
    if (!session) return { captured: false, reason: 'no-session' };

    const decision = await this.options.policy.evaluate({
      trigger: context.trigger,
      tabId: context.tabId,
      sessionId: session.id,
      visualCaptureEnabled: settings.visualCaptureEnabled,
      captureOnNavigation: settings.captureOnNavigation,
    });
    if (!decision.allowed) return { captured: false, reason: decision.reason };

    // Checked at the moment of capture rather than trusted from when the setting
    // was switched on: the user can revoke it in Chrome at any time.
    if (!(await this.options.hasCapturePermission())) {
      return { captured: false, reason: 'permission-not-granted' };
    }

    let dataUrl: string;
    try {
      dataUrl = await this.options.captureTab(context.windowId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.options.onError?.(`Capture failed: ${message}`);
      return { captured: false, reason: 'capture-failed' };
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { captured: false, reason: 'unreadable-image' };

    const byteSize = base64ByteLength(parsed.base64);
    if (byteSize > SCREENSHOT_LIMITS.maxBytes) {
      this.options.onError?.(`Capture discarded: ${String(byteSize)} bytes exceeds the limit.`);
      return { captured: false, reason: 'too-large' };
    }

    const screenshotId = this.newId();
    const capturedAt = this.now().toISOString();
    const sanitizedUrl = sanitizeUrl(context.url);

    const request: UploadScreenshotRequest = {
      installationId: await this.options.getInstallationId(),
      sessionId: session.id,
      screenshotId,
      capturedAt,
      format: parsed.format,
      imageBase64: parsed.base64,
      width: context.width ?? 0,
      height: context.height ?? 0,
      trigger: context.trigger,
      ...(sanitizedUrl !== undefined ? { pageUrl: sanitizedUrl } : {}),
      ...(domain !== undefined ? { domain } : {}),
      ...(context.title !== undefined ? { pageTitle: context.title } : {}),
      tabId: context.tabId,
    };

    const uploaded = await this.uploadWithOneRetry(request);
    if (!uploaded) return { captured: false, reason: 'upload-failed' };

    // Counted only once the image is actually stored, so a backend outage does
    // not silently consume the session's capture budget.
    await this.options.policy.recordCapture({
      trigger: context.trigger,
      tabId: context.tabId,
      sessionId: session.id,
    });

    await this.options.collector.record({
      type: 'SCREENSHOT_CAPTURED',
      url: context.url,
      title: context.title,
      tabId: context.tabId,
      windowId: context.windowId,
      metadata: { screenshotId, trigger: context.trigger, byteSize, format: parsed.format },
    });

    return { captured: true, screenshotId };
  }

  private async uploadWithOneRetry(request: UploadScreenshotRequest): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.options.uploader.upload(request);
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (attempt === 1) {
          this.options.onError?.(`Screenshot upload failed, discarding: ${message}`);
          return false;
        }
      }
    }
    return false;
  }
}
