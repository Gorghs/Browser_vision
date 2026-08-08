import type { OcrResult } from '@vab/types';

/**
 * Text extraction from an image.
 *
 * An interface rather than a direct Tesseract call so the engine can be swapped
 * — a hosted OCR service, a different local library — without the analysis
 * pipeline knowing. Everything above this line deals in `OcrResult`.
 */
export interface OcrEngine {
  readonly name: string;
  recognize(image: Uint8Array): Promise<OcrResult>;
  /** Releases whatever the engine holds open. Safe to call more than once. */
  shutdown(): Promise<void>;
}

/**
 * Cleans up what OCR produces.
 *
 * Engines emit ragged whitespace and stray single characters from icons and
 * borders. Left in, they waste the vision model's context on noise and make the
 * stored text unpleasant to read.
 */
export function tidyOcrText(raw: string, maxLength = 8000): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
    .join('\n')
    .slice(0, maxLength);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
