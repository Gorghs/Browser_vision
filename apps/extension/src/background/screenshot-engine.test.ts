import { describe, expect, it, vi } from 'vitest';
import type { BrowserEvent, UploadScreenshotRequest } from '@vab/types';
import { DEFAULT_SETTINGS } from '../services/settings.js';
import type { ExtensionSettings } from '../services/settings.js';
import { CapturePolicy, EMPTY_CAPTURE_STATE } from './capture-policy.js';
import type { CaptureState } from './capture-policy.js';
import { EventCollector } from './event-collector.js';
import { ScreenshotEngine, base64ByteLength, parseDataUrl } from './screenshot-engine.js';
import { SessionManager } from './session-manager.js';
import type { SessionStorage, StoredSession } from './session-manager.js';

const NOW = new Date('2026-08-07T10:00:00.000Z');
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

interface HarnessOptions {
  settings?: Partial<ExtensionSettings>;
  hasPermission?: boolean;
  captureTab?: () => Promise<string>;
  upload?: (request: UploadScreenshotRequest) => Promise<{ stored: boolean }>;
  startSession?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const collected: BrowserEvent[] = [];
  const uploads: UploadScreenshotRequest[] = [];
  const errors: string[] = [];

  let session: StoredSession | null = null;
  const sessionStorage: SessionStorage = {
    read: () => Promise.resolve(session),
    write: (next) => {
      session = next;
      return Promise.resolve();
    },
  };

  const sessions = new SessionManager({
    storage: sessionStorage,
    now: () => NOW,
    newId: () => 'session-1',
  });

  let captureState: CaptureState = { ...EMPTY_CAPTURE_STATE };
  const policy = new CapturePolicy({
    storage: {
      read: () => Promise.resolve(structuredClone(captureState)),
      write: (next) => {
        captureState = structuredClone(next);
        return Promise.resolve();
      },
    },
    now: () => NOW.getTime(),
  });

  const settings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    trackingEnabled: true,
    visualCaptureEnabled: true,
    ...options.settings,
  };

  const collector = new EventCollector({
    sink: {
      enqueue: (event) => {
        collected.push(event);
        return Promise.resolve();
      },
    },
    sessions,
    getSettings: () => Promise.resolve(settings),
    now: () => NOW,
    newId: () => 'event-1',
  });

  const upload =
    options.upload ??
    ((request: UploadScreenshotRequest) => {
      uploads.push(request);
      return Promise.resolve({ stored: true });
    });

  const engine = new ScreenshotEngine({
    policy,
    sessions,
    collector,
    uploader: { upload: vi.fn(upload) },
    getSettings: () => Promise.resolve(settings),
    getInstallationId: () => Promise.resolve('22222222-2222-4222-8222-222222222222'),
    captureTab: options.captureTab ?? (() => Promise.resolve(JPEG_DATA_URL)),
    hasCapturePermission: () => Promise.resolve(options.hasPermission ?? true),
    now: () => NOW,
    newId: () => '44444444-4444-4444-8444-444444444444',
    onError: (message) => errors.push(message),
  });

  const ready =
    options.startSession === false ? Promise.resolve() : sessions.ensure().then(() => undefined);

  return { engine, collected, uploads, errors, policy, ready };
}

const context = {
  trigger: 'navigation' as const,
  tabId: 7,
  windowId: 1,
  url: 'https://github.com/vercel/next.js/issues/1',
  title: 'An issue',
  width: 1920,
  height: 1080,
};

describe('helpers', () => {
  it('parses a jpeg data url', () => {
    expect(parseDataUrl('data:image/jpeg;base64,AAAA')).toEqual({ format: 'jpeg', base64: 'AAAA' });
  });

  it('treats image/jpg as jpeg', () => {
    expect(parseDataUrl('data:image/jpg;base64,AAAA')?.format).toBe('jpeg');
  });

  it('parses a png data url', () => {
    expect(parseDataUrl('data:image/png;base64,AAAA')?.format).toBe('png');
  });

  it('rejects something that is not an image data url', () => {
    expect(parseDataUrl('https://example.com/a.jpg')).toBeNull();
  });

  it.each([
    ['AAAA', 3],
    ['AAA=', 2],
    ['AA==', 1],
  ])('measures %s as %i bytes', (base64, expected) => {
    expect(base64ByteLength(base64)).toBe(expected);
  });
});

describe('privacy rules', () => {
  it('captures nothing while tracking is off', async () => {
    const harness = createHarness({ settings: { trackingEnabled: false } });
    await harness.ready;

    const outcome = await harness.engine.capture(context);

    expect(outcome).toEqual({ captured: false, reason: 'tracking-disabled' });
    expect(harness.uploads).toEqual([]);
  });

  it('captures nothing while visual capture is off', async () => {
    const harness = createHarness({ settings: { visualCaptureEnabled: false } });
    await harness.ready;

    expect(await harness.engine.capture(context)).toEqual({
      captured: false,
      reason: 'visual-capture-disabled',
    });
  });

  it('refuses to screenshot a blocked domain', async () => {
    const harness = createHarness({ settings: { blockedDomains: ['github.com'] } });
    await harness.ready;

    expect(await harness.engine.capture(context)).toEqual({
      captured: false,
      reason: 'blocked-domain',
    });
  });

  it('refuses to screenshot a subdomain of a blocked domain', async () => {
    const harness = createHarness({ settings: { blockedDomains: ['example.com'] } });
    await harness.ready;

    expect(
      await harness.engine.capture({ ...context, url: 'https://mail.example.com/inbox' }),
    ).toMatchObject({ reason: 'blocked-domain' });
  });

  it('refuses to screenshot a browser-internal page', async () => {
    const harness = createHarness();
    await harness.ready;

    expect(await harness.engine.capture({ ...context, url: 'chrome://settings' })).toEqual({
      captured: false,
      reason: 'untrackable-url',
    });
  });

  it('refuses when Chrome has not granted permission', async () => {
    const harness = createHarness({ hasPermission: false });
    await harness.ready;

    expect(await harness.engine.capture(context)).toEqual({
      captured: false,
      reason: 'permission-not-granted',
    });
  });

  it('checks the permission at capture time, not when the setting was saved', async () => {
    const harness = createHarness({ hasPermission: false });
    await harness.ready;

    await harness.engine.capture(context);

    // The tab is never read when permission is absent.
    expect(harness.uploads).toEqual([]);
  });

  it('strips the query string from the recorded page url', async () => {
    const harness = createHarness();
    await harness.ready;

    await harness.engine.capture({ ...context, url: 'https://example.com/r?token=secret' });

    expect(harness.uploads[0]?.pageUrl).toBe('https://example.com/r');
  });
});

describe('successful capture', () => {
  it('uploads the image with its page context', async () => {
    const harness = createHarness();
    await harness.ready;

    const outcome = await harness.engine.capture(context);

    expect(outcome.captured).toBe(true);
    expect(harness.uploads[0]).toMatchObject({
      sessionId: 'session-1',
      format: 'jpeg',
      trigger: 'navigation',
      domain: 'github.com',
      pageTitle: 'An issue',
      width: 1920,
      height: 1080,
    });
  });

  it('emits SCREENSHOT_CAPTURED only after the upload succeeds', async () => {
    const harness = createHarness();
    await harness.ready;

    await harness.engine.capture(context);

    const event = harness.collected.find((item) => item.type === 'SCREENSHOT_CAPTURED');
    expect(event?.metadata).toMatchObject({
      screenshotId: '44444444-4444-4444-8444-444444444444',
      trigger: 'navigation',
    });
  });

  it('sends the same id it puts on the event, so the two can be joined', async () => {
    const harness = createHarness();
    await harness.ready;

    await harness.engine.capture(context);

    const event = harness.collected.find((item) => item.type === 'SCREENSHOT_CAPTURED');
    expect(event?.metadata.screenshotId).toBe(harness.uploads[0]?.screenshotId);
  });

  it('counts the capture against the session budget', async () => {
    const harness = createHarness();
    await harness.ready;

    await harness.engine.capture(context);

    const decision = await harness.policy.evaluate({
      trigger: 'navigation',
      tabId: 7,
      sessionId: 'session-1',
      visualCaptureEnabled: true,
      captureOnNavigation: true,
    });
    expect(decision).toEqual({ allowed: false, reason: 'too-soon' });
  });
});

describe('failures', () => {
  it('reports a refusal from Chrome without throwing', async () => {
    const harness = createHarness({
      captureTab: () => Promise.reject(new Error('Cannot access contents of the page')),
    });
    await harness.ready;

    expect(await harness.engine.capture(context)).toEqual({
      captured: false,
      reason: 'capture-failed',
    });
    expect(harness.errors[0]).toContain('Cannot access contents');
  });

  it('discards an image that is not a readable data url', async () => {
    const harness = createHarness({ captureTab: () => Promise.resolve('not-an-image') });
    await harness.ready;

    expect(await harness.engine.capture(context)).toEqual({
      captured: false,
      reason: 'unreadable-image',
    });
  });

  it('discards an image beyond the size limit', async () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(9 * 1024 * 1024)}`;
    const harness = createHarness({ captureTab: () => Promise.resolve(huge) });
    await harness.ready;

    expect(await harness.engine.capture(context)).toEqual({ captured: false, reason: 'too-large' });
  });

  it('retries a failed upload once', async () => {
    const upload = vi
      .fn<(request: UploadScreenshotRequest) => Promise<{ stored: boolean }>>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue({ stored: true });
    const harness = createHarness({ upload });
    await harness.ready;

    const outcome = await harness.engine.capture(context);

    expect(outcome.captured).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry rather than buffering the image', async () => {
    const upload = vi
      .fn<(request: UploadScreenshotRequest) => Promise<{ stored: boolean }>>()
      .mockRejectedValue(new Error('backend down'));
    const harness = createHarness({ upload });
    await harness.ready;

    const outcome = await harness.engine.capture(context);

    expect(outcome).toEqual({ captured: false, reason: 'upload-failed' });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('reports a discarded capture rather than failing silently', async () => {
    const harness = createHarness({
      upload: () => Promise.reject(new Error('backend down')),
    });
    await harness.ready;

    await harness.engine.capture(context);

    expect(harness.errors.join(' ')).toContain('discarding');
  });

  it('does not emit SCREENSHOT_CAPTURED when the upload failed', async () => {
    const harness = createHarness({ upload: () => Promise.reject(new Error('backend down')) });
    await harness.ready;

    await harness.engine.capture(context);

    expect(harness.collected.some((event) => event.type === 'SCREENSHOT_CAPTURED')).toBe(false);
  });

  it('does not spend the capture budget on a failed upload', async () => {
    const harness = createHarness({ upload: () => Promise.reject(new Error('backend down')) });
    await harness.ready;

    await harness.engine.capture(context);

    const decision = await harness.policy.evaluate({
      trigger: 'navigation',
      tabId: 7,
      sessionId: 'session-1',
      visualCaptureEnabled: true,
      captureOnNavigation: true,
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('captures nothing when no session is running', async () => {
    const harness = createHarness({ startSession: false });

    expect(await harness.engine.capture(context)).toEqual({
      captured: false,
      reason: 'no-session',
    });
  });
});
