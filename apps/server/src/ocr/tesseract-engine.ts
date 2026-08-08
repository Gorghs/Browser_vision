import type { OcrResult } from '@vab/types';
import type { Logger } from '../lib/logger.js';
import { countWords, tidyOcrText } from './types.js';
import type { OcrEngine } from './types.js';

/**
 * Tesseract.js implementation.
 *
 * The worker is expensive to start — it loads a language model — so one is
 * created lazily and reused. It is created lazily rather than at boot because a
 * server with visual capture switched off should never pay for it at all.
 *
 * Tesseract downloads its language data on first use. That makes the first
 * recognition slow and dependent on network access; the analysis worker treats
 * a failure here as a recoverable step rather than a fatal one.
 */

/** Beyond this a single image is not worth blocking the queue for. */
const RECOGNITION_TIMEOUT_MS = 60_000;

interface TesseractWord {
  confidence?: number;
}

interface TesseractWorker {
  recognize(image: Uint8Array | Buffer): Promise<{
    data: { text: string; words?: TesseractWord[]; confidence?: number };
  }>;
  terminate(): Promise<void>;
}

export interface TesseractEngineOptions {
  logger: Logger;
  language?: string;
  /** Injected so tests never load a real language model. */
  createWorker?: (language: string) => Promise<TesseractWorker>;
}

export function createTesseractEngine(options: TesseractEngineOptions): OcrEngine {
  const language = options.language ?? 'eng';
  let workerPromise: Promise<TesseractWorker> | null = null;

  const start = async (): Promise<TesseractWorker> => {
    if (options.createWorker) return options.createWorker(language);

    options.logger.info('Starting the OCR worker', { language });
    // Imported here rather than at module load so a server with visual capture
    // off never pulls in the library or its language data.
    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker: (language: string) => Promise<TesseractWorker>;
    };
    return tesseract.createWorker(language);
  };

  const worker = (): Promise<TesseractWorker> => {
    workerPromise ??= start().catch((cause: unknown) => {
      // Cleared on failure so a transient startup problem does not poison every
      // later call with the same rejected promise.
      workerPromise = null;
      throw cause;
    });
    return workerPromise;
  };

  return {
    name: `tesseract.js:${language}`,

    async recognize(image) {
      const startedAt = Date.now();
      const active = await worker();

      const result = await Promise.race([
        active.recognize(Buffer.from(image)),
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`OCR timed out after ${String(RECOGNITION_TIMEOUT_MS)}ms`)),
            RECOGNITION_TIMEOUT_MS,
          ),
        ),
      ]);

      const text = tidyOcrText(result.data.text ?? '');
      const confidences = (result.data.words ?? [])
        .map((word) => word.confidence)
        .filter((value): value is number => typeof value === 'number');

      // Tesseract reports confidence as a percentage; the contract stores 0–1.
      const meanConfidence =
        confidences.length > 0
          ? confidences.reduce((total, value) => total + value, 0) / confidences.length / 100
          : typeof result.data.confidence === 'number'
            ? result.data.confidence / 100
            : null;

      const ocr: OcrResult = {
        text,
        wordCount: countWords(text),
        meanConfidence: meanConfidence === null ? null : Math.min(1, Math.max(0, meanConfidence)),
        engine: `tesseract.js:${language}`,
        durationMs: Date.now() - startedAt,
      };
      return ocr;
    },

    async shutdown() {
      const active = workerPromise;
      workerPromise = null;
      if (!active) return;
      await active.then((instance) => instance.terminate()).catch(() => undefined);
    },
  };
}
