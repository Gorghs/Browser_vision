import type { VisionAnalysis } from '@vab/types';

/**
 * The capability the application depends on.
 *
 * Deliberately narrow: one method, taking an image and its context and
 * returning validated structure. Nothing above this interface knows which
 * provider is configured, what a prompt looks like, or that HTTP is involved —
 * which is what keeps provider choice a configuration decision rather than an
 * architectural one.
 */
export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Returns raw text from the model. Parsing and validating it is the
   * AIService's job, so every provider gets identical treatment.
   */
  complete(input: VisionRequest): Promise<string>;
}

export interface VisionRequest {
  /** Raw image bytes, base64 encoded. */
  imageBase64: string;
  mimeType: string;
  prompt: string;
  /** Appended when a first attempt returned something unusable. */
  correction?: string;
}

export interface PageAnalysisInput {
  imageBase64: string;
  mimeType: string;
  pageUrl?: string | null;
  pageTitle?: string | null;
  domain?: string | null;
  /** Text pulled off the image by OCR, if any. */
  ocrText?: string | null;
}

export interface AnalysisOutcome {
  analysis: VisionAnalysis;
  provider: string;
  model: string;
  /** Exactly what the model returned, kept for auditing a disputed result. */
  raw: unknown;
}

/** Raised when a provider is asked for work it cannot do. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Raised when a model would not produce a valid response even after a retry. */
export class AiResponseError extends Error {
  constructor(
    message: string,
    readonly lastResponse: string,
  ) {
    super(message);
    this.name = 'AiResponseError';
  }
}
