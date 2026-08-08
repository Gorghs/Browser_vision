import type {
  AnalysisStatus,
  OcrResult,
  Screenshot,
  StoredAnalysis,
  TimelineActivity,
  VisionAnalysis,
} from '@vab/types';
import type {
  AnalysisInsert,
  AnalysisRepository,
  OcrRepository,
  PendingScreenshot,
  ScreenshotInsert,
  ScreenshotRepository,
  TimelineRepository,
  VisualRepositories,
} from '../visual-types.js';

/**
 * In-memory visual storage.
 *
 * Selected alongside the in-memory event repositories, so the whole Module 2
 * pipeline can be run and demonstrated without a Supabase account, and so the
 * API and worker tests need no database.
 */

interface StoredScreenshot extends ScreenshotInsert {
  userId: string;
  analysisStatus: AnalysisStatus;
  analysisAttempts: number;
  analysisError: string | null;
}

interface StoredAnalysisRow extends AnalysisInsert {
  id: string;
  createdAt: string;
}

export interface MemoryVisualRepositories extends VisualRepositories {
  /** Test-only hook for asserting on what was written. */
  readonly __screenshots: Map<string, StoredScreenshot>;
}

export function createMemoryVisualRepositories(
  /** Injected so tests can freeze time; the worker's retry logic depends on it. */
  now: () => Date = () => new Date(),
): MemoryVisualRepositories {
  const screenshots = new Map<string, StoredScreenshot>();
  const ocrResults = new Map<string, OcrResult>();
  const analyses: StoredAnalysisRow[] = [];
  const timelines = new Map<string, TimelineActivity[]>();
  const timelineOwners = new Map<string, string>();
  const timelineGeneratedAt = new Map<string, string>();

  const screenshotRepository: ScreenshotRepository = {
    insert(userId, screenshot) {
      if (screenshots.has(screenshot.id)) return Promise.resolve({ inserted: false });

      screenshots.set(screenshot.id, {
        ...screenshot,
        userId,
        analysisStatus: 'pending',
        analysisAttempts: 0,
        analysisError: null,
      });
      return Promise.resolve({ inserted: true });
    },

    findStorageLocation(id) {
      const stored = screenshots.get(id);
      return Promise.resolve(
        stored ? { bucket: stored.storageBucket, path: stored.storagePath } : null,
      );
    },

    claimPending(limit, maxAttempts) {
      const claimed = [...screenshots.values()]
        .filter(
          (screenshot) =>
            screenshot.analysisStatus === 'pending' && screenshot.analysisAttempts < maxAttempts,
        )
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .slice(0, limit);

      const pending: PendingScreenshot[] = claimed.map((screenshot) => {
        // Marked before the work starts, so a second worker pass cannot pick up
        // the same screenshot while the first is still on it.
        screenshot.analysisStatus = 'processing';
        screenshot.analysisAttempts += 1;
        return {
          id: screenshot.id,
          sessionId: screenshot.sessionId,
          userId: screenshot.userId,
          storagePath: screenshot.storagePath,
          format: screenshot.format,
          capturedAt: screenshot.capturedAt,
          pageUrl: screenshot.pageUrl ?? null,
          domain: screenshot.domain ?? null,
          pageTitle: screenshot.pageTitle ?? null,
          attempts: screenshot.analysisAttempts,
        };
      });

      return Promise.resolve(pending);
    },

    setStatus(id, status, error) {
      const stored = screenshots.get(id);
      if (stored) {
        stored.analysisStatus = status;
        stored.analysisError = error ?? null;
      }
      return Promise.resolve();
    },

    list(userId, filter) {
      const needle = filter.q?.toLowerCase();
      const matching = [...screenshots.values()]
        .filter((screenshot) => userId === null || screenshot.userId === userId)
        .filter(
          (screenshot) =>
            filter.sessionId === undefined || screenshot.sessionId === filter.sessionId,
        )
        .filter(
          (screenshot) =>
            filter.status === undefined || screenshot.analysisStatus === filter.status,
        )
        .filter((screenshot) => {
          if (needle === undefined) return true;
          const pageFields = [screenshot.pageUrl, screenshot.pageTitle, screenshot.domain];
          if (
            pageFields.some((value) => value !== undefined && value.toLowerCase().includes(needle))
          ) {
            return true;
          }
          const text = ocrResults.get(screenshot.id)?.text;
          return text !== undefined && text.toLowerCase().includes(needle);
        })
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

      const page = matching.slice(filter.offset, filter.offset + filter.limit).map((stored) => {
        const analysisRow = analyses.filter((row) => row.screenshotId === stored.id).at(-1);
        const screenshot: Screenshot = {
          id: stored.id,
          sessionId: stored.sessionId,
          capturedAt: stored.capturedAt,
          format: stored.format,
          width: stored.width,
          height: stored.height,
          byteSize: stored.byteSize,
          trigger: stored.trigger,
          pageUrl: stored.pageUrl ?? null,
          domain: stored.domain ?? null,
          pageTitle: stored.pageTitle ?? null,
          analysisStatus: stored.analysisStatus,
          analysisError: stored.analysisError,
          ocr: ocrResults.get(stored.id) ?? null,
          analysis: analysisRow
            ? {
                id: analysisRow.id,
                screenshotId: analysisRow.screenshotId,
                sessionId: analysisRow.sessionId,
                provider: analysisRow.provider,
                model: analysisRow.model,
                createdAt: analysisRow.createdAt,
                page: analysisRow.page,
                activity: analysisRow.activity,
              }
            : null,
        };
        return screenshot;
      });

      return Promise.resolve({ screenshots: page, total: matching.length });
    },
  };

  const ocrRepository: OcrRepository = {
    upsert(screenshotId, result) {
      ocrResults.set(screenshotId, result);
      return Promise.resolve();
    },
    findText(screenshotId) {
      return Promise.resolve(ocrResults.get(screenshotId)?.text ?? null);
    },
  };

  const analysisRepository: AnalysisRepository = {
    insert(analysis) {
      const id = crypto.randomUUID();
      analyses.push({ ...analysis, id, createdAt: now().toISOString() });
      return Promise.resolve({ id });
    },

    listForSession(sessionId) {
      const rows = analyses
        .filter((row) => row.sessionId === sessionId)
        .map((row) => ({
          screenshotId: row.screenshotId,
          capturedAt: screenshots.get(row.screenshotId)?.capturedAt ?? row.createdAt,
          analysis: { page: row.page, activity: row.activity } satisfies VisionAnalysis,
        }))
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

      return Promise.resolve(rows);
    },

    search(_userId, sessionId, q, limit) {
      // Analyses are scoped by session (their rows carry no user id; reads are
      // unscoped today), so `userId` is accepted for interface consistency but
      // only the session narrows the search.
      const needle = q.toLowerCase();
      const matching = analyses
        .filter((row) => sessionId === undefined || row.sessionId === sessionId)
        .filter((row) =>
          [
            row.page.pageType,
            row.page.purpose,
            row.page.visibleContentSummary,
            row.activity.userIntent,
            row.activity.currentTask,
            row.activity.summary,
          ].some((value) => value !== undefined && value.toLowerCase().includes(needle)),
        )
        .slice(0, limit);

      return Promise.resolve(
        matching.map<StoredAnalysis>((row) => ({
          id: row.id,
          screenshotId: row.screenshotId,
          sessionId: row.sessionId,
          provider: row.provider,
          model: row.model,
          createdAt: row.createdAt,
          page: row.page,
          activity: row.activity,
        })),
      );
    },
  };

  const timelineRepository: TimelineRepository = {
    replaceForSession(userId, sessionId, activities) {
      timelines.set(sessionId, activities);
      timelineOwners.set(sessionId, userId);
      timelineGeneratedAt.set(sessionId, now().toISOString());
      return Promise.resolve();
    },

    list(userId, sessionId, limit) {
      const all = [...timelines.entries()]
        .filter(([id]) => sessionId === undefined || id === sessionId)
        .filter(([id]) => userId === null || timelineOwners.get(id) === userId)
        .flatMap(([, activities]) => activities)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      return Promise.resolve(all.slice(0, limit));
    },

    search(userId, sessionId, q, limit) {
      const needle = q.toLowerCase();
      const matching = [...timelines.entries()]
        .filter(([id]) => sessionId === undefined || id === sessionId)
        .filter(([id]) => userId === null || timelineOwners.get(id) === userId)
        .flatMap(([, activities]) => activities)
        .filter(
          (activity) =>
            activity.title.toLowerCase().includes(needle) ||
            (activity.description !== null && activity.description.toLowerCase().includes(needle)),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);

      return Promise.resolve(matching);
    },
  };

  return {
    screenshots: screenshotRepository,
    ocr: ocrRepository,
    analyses: analysisRepository,
    timeline: timelineRepository,
    __screenshots: screenshots,
  };
}
