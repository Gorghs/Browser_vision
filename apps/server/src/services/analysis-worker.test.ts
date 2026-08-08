import { describe, expect, it, vi } from 'vitest';
import type { OcrResult } from '@vab/types';
import { AIService } from '../ai/ai-service.js';
import { AiUnavailableError } from '../ai/types.js';
import type { VisionProvider, VisionRequest } from '../ai/types.js';
import { createLogger } from '../lib/logger.js';
import type { OcrEngine } from '../ocr/types.js';
import { createMemoryRepositories } from '../repositories/memory/index.js';
import { createMemoryVisualRepositories } from '../repositories/memory/visual.js';
import type { ObjectStore } from '../storage/object-store.js';
import { AnalysisWorker } from './analysis-worker.js';
import { TimelineService } from './timeline.service.js';

/**
 * Drives the whole pipeline against in-memory storage: image, OCR, vision,
 * persisted analysis and rebuilt timeline. Only the model and the OCR engine are
 * substituted, so what runs here is what runs in production.
 */

const SESSION = '11111111-1111-4111-8111-111111111111';
const INSTALLATION = '22222222-2222-4222-8222-222222222222';
const START = Date.UTC(2026, 7, 7, 10, 0, 0);

const VALID_ANALYSIS = {
  page: {
    pageType: 'github_issue',
    category: 'development',
    purpose: 'Reading a bug report',
    importantElements: ['issue title'],
  },
  activity: {
    userIntent: 'Understand the bug',
    currentTask: 'Investigating a caching bug',
    activityCategory: 'development',
    summary: 'Reading a GitHub issue about caching',
  },
};

interface HarnessOptions {
  aiResponse?: string;
  aiError?: Error;
  ocr?: OcrEngine | undefined;
  storeFails?: boolean;
}

async function createHarness(options: HarnessOptions = {}) {
  const repositories = createMemoryRepositories();
  const visual = createMemoryVisualRepositories();
  const logs: string[] = [];
  const logger = createLogger({ level: 'error', write: (line) => logs.push(line) });

  const files = new Map<string, Uint8Array>();
  const store: ObjectStore = {
    bucket: 'test',
    kind: 'filesystem',
    put: (path, bytes) => {
      files.set(path, bytes);
      return Promise.resolve();
    },
    get: (path) => {
      if (options.storeFails) return Promise.reject(new Error('object missing'));
      const bytes = files.get(path);
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('not found'));
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };

  const complete = vi.fn((_input: VisionRequest) =>
    options.aiError
      ? Promise.reject(options.aiError)
      : Promise.resolve(options.aiResponse ?? JSON.stringify(VALID_ANALYSIS)),
  );
  const provider: VisionProvider = { name: 'stub', model: 'stub-1', complete };

  const userId = await repositories.users.ensure(INSTALLATION);
  await repositories.sessions.upsertMany(userId, [
    { id: SESSION, startedAt: new Date(START).toISOString() },
  ]);

  const worker = new AnalysisWorker({
    repositories,
    visual,
    store,
    ai: new AIService(options.aiResponse === 'NONE' ? undefined : provider, logger),
    timeline: new TimelineService(repositories, visual),
    logger,
    ocr: options.ocr,
    intervalMs: 0,
  });

  const addScreenshot = async (id: string, capturedAtOffsetMs = 0) => {
    const path = `2026-08-07/${id}.jpg`;
    files.set(path, new Uint8Array([1, 2, 3, 4]));
    await visual.screenshots.insert(userId, {
      id,
      sessionId: SESSION,
      storageBucket: 'test',
      storagePath: path,
      capturedAt: new Date(START + capturedAtOffsetMs).toISOString(),
      format: 'jpeg',
      width: 1920,
      height: 1080,
      byteSize: 4,
      trigger: 'navigation',
      pageUrl: 'https://github.com/vercel/next.js/issues/1',
      domain: 'github.com',
      pageTitle: 'An issue',
    });
  };

  const addEvents = async (count: number) => {
    await repositories.events.insertMany(
      userId,
      Array.from({ length: count }, (_unused, index) => ({
        id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
        sessionId: SESSION,
        type: 'PAGE_LOADED' as const,
        timestamp: new Date(START + index * 1000).toISOString(),
        domain: 'github.com',
        url: `https://github.com/page-${String(index)}`,
        metadata: {},
      })),
    );
  };

  const statusOf = async (id: string) => {
    const { screenshots } = await visual.screenshots.list(null, { limit: 50, offset: 0 });
    return screenshots.find((screenshot) => screenshot.id === id);
  };

  return {
    worker,
    visual,
    repositories,
    userId,
    complete,
    logs,
    addScreenshot,
    addEvents,
    statusOf,
  };
}

const SCREENSHOT_ID = '44444444-4444-4444-8444-444444444444';

function stubOcr(result: Partial<OcrResult> = {}): OcrEngine {
  return {
    name: 'stub-ocr',
    recognize: () =>
      Promise.resolve({
        text: 'Router cache not invalidating',
        wordCount: 4,
        meanConfidence: 0.9,
        engine: 'stub-ocr',
        durationMs: 5,
        ...result,
      }),
    shutdown: () => Promise.resolve(),
  };
}

describe('the happy path', () => {
  it('analyses a pending screenshot', async () => {
    const harness = await createHarness();
    await harness.addScreenshot(SCREENSHOT_ID);

    const { processed } = await harness.worker.runOnce();

    expect(processed).toBe(1);
    expect((await harness.statusOf(SCREENSHOT_ID))?.analysisStatus).toBe('completed');
  });

  it('stores the structured understanding', async () => {
    const harness = await createHarness();
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    expect((await harness.statusOf(SCREENSHOT_ID))?.analysis).toMatchObject({
      provider: 'stub',
      model: 'stub-1',
      page: { pageType: 'github_issue' },
      activity: { currentTask: 'Investigating a caching bug' },
    });
  });

  it('runs OCR and stores the extracted text', async () => {
    const harness = await createHarness({ ocr: stubOcr() });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    expect((await harness.statusOf(SCREENSHOT_ID))?.ocr).toMatchObject({
      text: 'Router cache not invalidating',
      wordCount: 4,
      engine: 'stub-ocr',
    });
  });

  it('gives the OCR text to the model as context', async () => {
    const harness = await createHarness({ ocr: stubOcr() });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    expect(harness.complete.mock.calls[0]?.[0].prompt).toContain('Router cache not invalidating');
  });

  it('records processing milestones in the session event log', async () => {
    const harness = await createHarness({ ocr: stubOcr() });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    const { events } = await harness.repositories.events.list(null, { limit: 50, offset: 0 });
    const types = events.map((event) => event.type);
    expect(types).toContain('OCR_COMPLETED');
    expect(types).toContain('AI_ANALYSIS_COMPLETED');
  });

  it('rebuilds the session timeline from the new understanding', async () => {
    const harness = await createHarness();
    await harness.addEvents(4);
    await harness.addScreenshot(SCREENSHOT_ID, 1000);

    await harness.worker.runOnce();

    const activities = await harness.visual.timeline.list(null, SESSION, 10);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      title: 'Investigating a caching bug',
      source: 'ai',
    });
  });

  it('processes several screenshots in one pass', async () => {
    const harness = await createHarness();
    await harness.addScreenshot(SCREENSHOT_ID, 0);
    await harness.addScreenshot('55555555-5555-4555-8555-555555555555', 1000);

    const { processed } = await harness.worker.runOnce();

    expect(processed).toBe(2);
  });

  it('does nothing when there is no pending work', async () => {
    const harness = await createHarness();

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 0 });
  });

  it('does not reprocess a completed screenshot', async () => {
    const harness = await createHarness();
    await harness.addScreenshot(SCREENSHOT_ID);
    await harness.worker.runOnce();

    const second = await harness.worker.runOnce();

    expect(second.processed).toBe(0);
    expect(harness.complete).toHaveBeenCalledTimes(1);
  });
});

describe('degrading rather than aborting', () => {
  it('completes without analysis when no AI is configured', async () => {
    const harness = await createHarness({ aiResponse: 'NONE' });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    const stored = await harness.statusOf(SCREENSHOT_ID);
    expect(stored?.analysisStatus).toBe('completed');
    expect(stored?.analysis).toBeNull();
  });

  it('still stores OCR text when no AI is configured', async () => {
    const harness = await createHarness({ aiResponse: 'NONE', ocr: stubOcr() });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    expect((await harness.statusOf(SCREENSHOT_ID))?.ocr?.wordCount).toBe(4);
  });

  it('still builds a timeline when no AI is configured', async () => {
    const harness = await createHarness({ aiResponse: 'NONE' });
    await harness.addEvents(4);
    await harness.addScreenshot(SCREENSHOT_ID, 1000);

    await harness.worker.runOnce();

    const activities = await harness.visual.timeline.list(null, SESSION, 10);
    expect(activities[0]?.source).toBe('derived');
    expect(activities[0]?.title).toBe('github.com');
  });

  it('analyses from the image alone when OCR fails', async () => {
    const failingOcr: OcrEngine = {
      name: 'broken',
      recognize: () => Promise.reject(new Error('worker crashed')),
      shutdown: () => Promise.resolve(),
    };
    const harness = await createHarness({ ocr: failingOcr });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    const stored = await harness.statusOf(SCREENSHOT_ID);
    expect(stored?.analysisStatus).toBe('completed');
    expect(stored?.ocr).toBeNull();
  });
});

describe('failures', () => {
  it('retries a transient provider failure', async () => {
    const harness = await createHarness({ aiError: new AiUnavailableError('429 rate limited') });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    // Back to pending, so a later pass picks it up again.
    expect((await harness.statusOf(SCREENSHOT_ID))?.analysisStatus).toBe('pending');
  });

  it('records why the attempt failed', async () => {
    const harness = await createHarness({ aiError: new AiUnavailableError('429 rate limited') });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    expect((await harness.statusOf(SCREENSHOT_ID))?.analysisError).toContain('unavailable');
  });

  it('gives up after the attempt ceiling rather than retrying forever', async () => {
    const harness = await createHarness({ aiError: new AiUnavailableError('permanently down') });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();
    await harness.worker.runOnce();
    await harness.worker.runOnce();
    const fourth = await harness.worker.runOnce();

    expect((await harness.statusOf(SCREENSHOT_ID))?.analysisStatus).toBe('failed');
    expect(fourth.processed).toBe(0);
  });

  it('abandons a screenshot whose image has gone', async () => {
    const harness = await createHarness({ storeFails: true });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();

    const stored = await harness.statusOf(SCREENSHOT_ID);
    expect(stored?.analysisStatus).toBe('failed');
    expect(stored?.analysisError).toContain('could not be read');
  });

  it('does not retry a missing image, since retrying cannot help', async () => {
    const harness = await createHarness({ storeFails: true });
    await harness.addScreenshot(SCREENSHOT_ID);

    await harness.worker.runOnce();
    const second = await harness.worker.runOnce();

    expect(second.processed).toBe(0);
  });

  it('marks a screenshot failed when the model will not produce valid output', async () => {
    const harness = await createHarness({ aiResponse: 'I cannot help with that.' });
    await harness.addScreenshot(SCREENSHOT_ID);

    for (let pass = 0; pass < 3; pass += 1) await harness.worker.runOnce();

    expect((await harness.statusOf(SCREENSHOT_ID))?.analysisStatus).toBe('failed');
  });

  it('keeps the screenshot and its metadata even when analysis is abandoned', async () => {
    const harness = await createHarness({ aiError: new AiUnavailableError('down') });
    await harness.addScreenshot(SCREENSHOT_ID);

    for (let pass = 0; pass < 4; pass += 1) await harness.worker.runOnce();

    const stored = await harness.statusOf(SCREENSHOT_ID);
    expect(stored).toBeDefined();
    expect(stored?.pageUrl).toBe('https://github.com/vercel/next.js/issues/1');
  });

  it('does not let one failing screenshot stop the others', async () => {
    const harness = await createHarness();
    await harness.addScreenshot(SCREENSHOT_ID, 0);
    await harness.addScreenshot('55555555-5555-4555-8555-555555555555', 1000);

    const { processed } = await harness.worker.runOnce();

    expect(processed).toBe(2);
  });
});

describe('concurrency', () => {
  it('does not process the same batch twice when passes overlap', async () => {
    const harness = await createHarness();
    await harness.addScreenshot(SCREENSHOT_ID);

    const [first, second] = await Promise.all([harness.worker.runOnce(), harness.worker.runOnce()]);

    expect(first.processed + second.processed).toBe(1);
    expect(harness.complete).toHaveBeenCalledTimes(1);
  });
});
