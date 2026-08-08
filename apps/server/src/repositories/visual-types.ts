import type {
  AnalysisStatus,
  OcrResult,
  Screenshot,
  ScreenshotFormat,
  TimelineActivity,
  VisionAnalysis,
} from '@vab/types';

/** Persistence contracts for Module 2, kept beside the Module 1 ones. */

export interface ScreenshotInsert {
  id: string;
  sessionId: string;
  storageBucket: string;
  storagePath: string;
  capturedAt: string;
  format: ScreenshotFormat;
  width: number;
  height: number;
  byteSize: number;
  trigger: 'manual' | 'navigation';
  pageUrl?: string | undefined;
  domain?: string | undefined;
  pageTitle?: string | undefined;
  browserTabId?: number | undefined;
}

/** A screenshot as the analysis worker needs it: metadata plus where the bytes are. */
export interface PendingScreenshot {
  id: string;
  sessionId: string;
  userId: string;
  storagePath: string;
  format: ScreenshotFormat;
  capturedAt: string;
  pageUrl: string | null;
  domain: string | null;
  pageTitle: string | null;
  attempts: number;
}

export interface ScreenshotFilter {
  sessionId?: string | undefined;
  status?: AnalysisStatus | undefined;
  limit: number;
  offset: number;
}

export interface ScreenshotRepository {
  /** Returns false when this id was already stored, so a retry is a no-op. */
  insert(userId: string, screenshot: ScreenshotInsert): Promise<{ inserted: boolean }>;
  /** Where a stored screenshot's bytes live, or null if there is no such row. */
  findStorageLocation(id: string): Promise<{ bucket: string; path: string } | null>;
  /** Oldest screenshots still awaiting analysis. */
  claimPending(limit: number, maxAttempts: number): Promise<PendingScreenshot[]>;
  setStatus(id: string, status: AnalysisStatus, error?: string | null): Promise<void>;
  list(
    userId: string | null,
    filter: ScreenshotFilter,
  ): Promise<{ screenshots: Screenshot[]; total: number }>;
}

export interface OcrRepository {
  upsert(screenshotId: string, result: OcrResult): Promise<void>;
  /** OCR text for a screenshot, used as context for the vision model. */
  findText(screenshotId: string): Promise<string | null>;
}

export interface AnalysisInsert extends VisionAnalysis {
  screenshotId: string;
  sessionId: string;
  provider: string;
  model: string;
  raw: unknown;
}

export interface AnalysisRepository {
  insert(analysis: AnalysisInsert): Promise<{ id: string }>;
  /**
   * Analyses for a session, oldest first.
   *
   * The timeline builder uses these to describe activities, so it needs them in
   * the order the pages were seen rather than the order they were processed.
   */
  listForSession(
    sessionId: string,
  ): Promise<{ screenshotId: string; capturedAt: string; analysis: VisionAnalysis }[]>;
}

export interface TimelineRepository {
  /**
   * Replaces a session's activities wholesale.
   *
   * Activity boundaries move as later events arrive — a gap that looked like an
   * ending turns out to be a pause — so amending in place would leave stale
   * fragments behind.
   */
  replaceForSession(
    userId: string,
    sessionId: string,
    activities: TimelineActivity[],
  ): Promise<void>;
  list(
    userId: string | null,
    sessionId: string | undefined,
    limit: number,
  ): Promise<TimelineActivity[]>;
}

export interface VisualRepositories {
  screenshots: ScreenshotRepository;
  ocr: OcrRepository;
  analyses: AnalysisRepository;
  timeline: TimelineRepository;
}
