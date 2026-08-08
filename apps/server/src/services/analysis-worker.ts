import { AiResponseError, AiUnavailableError } from '../ai/types.js';
import type { AIService } from '../ai/ai-service.js';
import { describeError } from '../lib/logger.js';
import type { Logger } from '../lib/logger.js';
import type { OcrEngine } from '../ocr/types.js';
import type { Repositories } from '../repositories/types.js';
import type { PendingScreenshot, VisualRepositories } from '../repositories/visual-types.js';
import type { ObjectStore } from '../storage/object-store.js';
import type { TimelineService } from './timeline.service.js';

/**
 * Turns stored screenshots into understanding.
 *
 * An in-process poller rather than a queue service. The specification is
 * explicit that Redis, Kafka and friends are not to be introduced without a real
 * requirement, and at one browser's rate of capture a timer over a status column
 * is genuinely sufficient. The repository interface is what a real queue would
 * slot behind later.
 *
 * The pipeline is: image → OCR → vision → persisted analysis → rebuilt timeline.
 * Each step degrades rather than aborts. OCR failing still allows analysis from
 * the image alone; analysis failing still leaves the screenshot and its text;
 * both failing still leaves a timeline built from events. That is what makes AI
 * an enhancement layer rather than a dependency.
 */

/** Screenshots taken per pass. Small, so one slow image cannot stall the rest. */
const BATCH_SIZE = 3;

/**
 * Attempts before a screenshot is abandoned.
 *
 * Three, because the failures worth retrying are transient — a rate limit, a
 * timeout — and the ones that are not will fail identically forever.
 */
const MAX_ATTEMPTS = 3;

const MIME_TYPES: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png' };

export interface AnalysisWorkerOptions {
  repositories: Repositories;
  visual: VisualRepositories;
  store: ObjectStore;
  ai: AIService;
  timeline: TimelineService;
  logger: Logger;
  /** Undefined when OCR is switched off. */
  ocr?: OcrEngine | undefined;
  intervalMs: number;
}

export class AnalysisWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly options: AnalysisWorkerOptions) {}

  start(): void {
    if (this.options.intervalMs === 0) {
      this.options.logger.info('Analysis worker disabled by configuration.');
      return;
    }

    this.options.logger.info('Analysis worker started', {
      intervalMs: this.options.intervalMs,
      ocr: this.options.ocr?.name ?? 'disabled',
      ai: this.options.ai.description,
    });

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.intervalMs);
    // Keeps the timer from holding the process open during shutdown.
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.options.ocr?.shutdown();
  }

  /**
   * Processes one batch. Public so tests can drive it deterministically rather
   * than waiting on a timer.
   */
  async runOnce(): Promise<{ processed: number }> {
    // A pass still in flight when the next tick fires would double-process the
    // batch it already claimed.
    if (this.running) return { processed: 0 };
    this.running = true;

    try {
      const pending = await this.options.visual.screenshots.claimPending(BATCH_SIZE, MAX_ATTEMPTS);
      if (pending.length === 0) return { processed: 0 };

      const touchedSessions = new Map<string, string>();
      for (const screenshot of pending) {
        await this.process(screenshot);
        touchedSessions.set(screenshot.sessionId, screenshot.userId);
      }

      // Rebuilt once per session per pass rather than once per screenshot: the
      // rebuild is wholesale, so doing it per image would be pure waste.
      for (const [sessionId, userId] of touchedSessions) {
        await this.options.timeline.rebuild(userId, sessionId).catch((cause: unknown) => {
          this.options.logger.error('Rebuilding a timeline failed', {
            sessionId,
            ...describeError(cause),
          });
        });
      }

      return { processed: pending.length };
    } catch (cause) {
      // A failure here is in the worker itself, not in one screenshot. It must
      // not kill the timer, or analysis stops silently until a restart.
      this.options.logger.error('Analysis pass failed', describeError(cause));
      return { processed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async process(screenshot: PendingScreenshot): Promise<void> {
    const log = this.options.logger.child({ screenshotId: screenshot.id });

    let image: Uint8Array;
    try {
      image = await this.options.store.get(screenshot.storagePath);
    } catch (cause) {
      // The bytes are gone; no number of retries will bring them back.
      await this.fail(
        screenshot,
        'The screenshot image could not be read from storage.',
        log,
        cause,
      );
      return;
    }

    const ocrText = await this.runOcr(screenshot, image, log);

    if (!this.options.ai.available) {
      // Not a failure. The screenshot is stored and readable; there is simply
      // no model configured to interpret it.
      await this.options.visual.screenshots.setStatus(screenshot.id, 'completed', null);
      return;
    }

    try {
      const outcome = await this.options.ai.analyzePage({
        imageBase64: Buffer.from(image).toString('base64'),
        mimeType: MIME_TYPES[screenshot.format] ?? 'image/jpeg',
        pageUrl: screenshot.pageUrl,
        pageTitle: screenshot.pageTitle,
        domain: screenshot.domain,
        ocrText,
      });

      await this.options.visual.analyses.insert({
        screenshotId: screenshot.id,
        sessionId: screenshot.sessionId,
        provider: outcome.provider,
        model: outcome.model,
        raw: outcome.raw,
        ...outcome.analysis,
      });

      await this.recordEvent(screenshot, 'AI_ANALYSIS_COMPLETED', {
        screenshotId: screenshot.id,
        provider: outcome.provider,
        model: outcome.model,
        category: outcome.analysis.activity.activityCategory,
      });

      await this.options.visual.screenshots.setStatus(screenshot.id, 'completed', null);
      log.info('Screenshot analysed', {
        provider: outcome.provider,
        category: outcome.analysis.activity.activityCategory,
      });
    } catch (cause) {
      const message =
        cause instanceof AiResponseError
          ? `The model did not return a usable analysis: ${cause.message}`
          : cause instanceof AiUnavailableError
            ? `The AI provider was unavailable: ${cause.message}`
            : 'Analysis failed unexpectedly.';

      if (screenshot.attempts >= MAX_ATTEMPTS) {
        await this.fail(screenshot, message, log, cause);
        return;
      }

      // Back to pending so a later pass tries again, up to the attempt ceiling.
      await this.options.visual.screenshots.setStatus(screenshot.id, 'pending', message);
      log.warn('Analysis failed; will retry', {
        attempt: screenshot.attempts,
        ...describeError(cause),
      });
    }
  }

  /** OCR is best-effort: its failure must not cost the analysis. */
  private async runOcr(
    screenshot: PendingScreenshot,
    image: Uint8Array,
    log: Logger,
  ): Promise<string | null> {
    const engine = this.options.ocr;
    if (!engine) return null;

    try {
      const result = await engine.recognize(image);
      await this.options.visual.ocr.upsert(screenshot.id, result);
      await this.recordEvent(screenshot, 'OCR_COMPLETED', {
        screenshotId: screenshot.id,
        wordCount: result.wordCount,
        engine: result.engine,
      });
      return result.text;
    } catch (cause) {
      log.warn('OCR failed; continuing without extracted text', describeError(cause));
      return null;
    }
  }

  private async fail(
    screenshot: PendingScreenshot,
    message: string,
    log: Logger,
    cause: unknown,
  ): Promise<void> {
    await this.options.visual.screenshots.setStatus(screenshot.id, 'failed', message);
    log.error('Screenshot analysis abandoned', { reason: message, ...describeError(cause) });
  }

  /**
   * Writes a processing milestone into the session's event log.
   *
   * Best-effort: a screenshot that was analysed but whose event could not be
   * written is still analysed, and losing the breadcrumb is not worth failing
   * the work that produced it.
   */
  private async recordEvent(
    screenshot: PendingScreenshot,
    type: 'OCR_COMPLETED' | 'AI_ANALYSIS_COMPLETED',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.options.repositories.events.insertMany(screenshot.userId, [
        {
          id: crypto.randomUUID(),
          sessionId: screenshot.sessionId,
          type,
          timestamp: new Date().toISOString(),
          metadata,
          ...(screenshot.pageUrl !== null ? { url: screenshot.pageUrl } : {}),
          ...(screenshot.domain !== null ? { domain: screenshot.domain } : {}),
        },
      ]);
    } catch (cause) {
      this.options.logger.warn('Could not record a processing event', describeError(cause));
    }
  }
}
