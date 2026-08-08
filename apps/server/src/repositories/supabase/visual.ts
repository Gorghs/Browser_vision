import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityCategory,
  AnalysisStatus,
  Screenshot,
  ScreenshotFormat,
  StoredAnalysis,
  TimelineActivity,
  VisionAnalysis,
} from '@vab/types';
import { StorageError } from '../../lib/errors.js';
import type {
  AnalysisRepository,
  OcrRepository,
  PendingScreenshot,
  ScreenshotRepository,
  TimelineRepository,
  VisualRepositories,
} from '../visual-types.js';

/** Supabase-backed persistence for screenshots, OCR, analyses and timelines. */

function fail(operation: string, error: PostgrestError): never {
  throw new StorageError(`${operation} failed: ${error.message}`, error);
}

interface ScreenshotRow {
  id: string;
  session_id: string;
  captured_at: string;
  format: string;
  width: number;
  height: number;
  byte_size: number;
  trigger: string;
  page_url: string | null;
  domain: string | null;
  page_title: string | null;
  analysis_status: string;
  analysis_error: string | null;
}

interface OcrRow {
  screenshot_id: string;
  text: string;
  word_count: number;
  mean_confidence: number | null;
  engine: string;
  duration_ms: number;
}

interface AnalysisRow {
  id: string;
  screenshot_id: string;
  session_id: string;
  provider: string;
  model: string;
  created_at: string;
  page_type: string;
  category: string;
  purpose: string;
  important_elements: unknown;
  visible_content_summary: string | null;
  user_intent: string;
  current_task: string;
  activity_category: string;
  summary: string;
  confidence: number | null;
}

function toVisionAnalysis(row: AnalysisRow): VisionAnalysis {
  return {
    page: {
      pageType: row.page_type,
      category: row.category as ActivityCategory,
      purpose: row.purpose,
      importantElements: Array.isArray(row.important_elements)
        ? (row.important_elements as string[])
        : [],
      ...(row.visible_content_summary !== null
        ? { visibleContentSummary: row.visible_content_summary }
        : {}),
    },
    activity: {
      userIntent: row.user_intent,
      currentTask: row.current_task,
      activityCategory: row.activity_category as ActivityCategory,
      summary: row.summary,
      ...(row.confidence !== null ? { confidence: row.confidence } : {}),
    },
  };
}

export function createSupabaseVisualRepositories(client: SupabaseClient): VisualRepositories {
  const screenshots: ScreenshotRepository = {
    async insert(userId, screenshot) {
      // `ignoreDuplicates` makes a re-sent upload a no-op rather than an error,
      // matching how event ingest treats a replayed batch.
      const { data, error } = await client
        .from('screenshots')
        .upsert(
          {
            id: screenshot.id,
            session_id: screenshot.sessionId,
            user_id: userId,
            storage_bucket: screenshot.storageBucket,
            storage_path: screenshot.storagePath,
            captured_at: screenshot.capturedAt,
            format: screenshot.format,
            width: screenshot.width,
            height: screenshot.height,
            byte_size: screenshot.byteSize,
            trigger: screenshot.trigger,
            page_url: screenshot.pageUrl ?? null,
            domain: screenshot.domain ?? null,
            page_title: screenshot.pageTitle ?? null,
            browser_tab_id: screenshot.browserTabId ?? null,
          },
          { onConflict: 'id', ignoreDuplicates: true },
        )
        .select('id')
        .returns<{ id: string }[]>();

      if (error) fail('Inserting a screenshot', error);
      return { inserted: data.length > 0 };
    },

    async findStorageLocation(id) {
      const { data, error } = await client
        .from('screenshots')
        .select('storage_bucket, storage_path')
        .eq('id', id)
        .maybeSingle<{ storage_bucket: string; storage_path: string }>();

      if (error) fail('Finding a screenshot', error);
      return data ? { bucket: data.storage_bucket, path: data.storage_path } : null;
    },

    async claimPending(limit, maxAttempts) {
      const { data, error } = await client
        .from('screenshots')
        .select(
          'id, session_id, user_id, storage_path, format, captured_at, page_url, domain, page_title, analysis_attempts',
        )
        .eq('analysis_status', 'pending')
        .lt('analysis_attempts', maxAttempts)
        .order('captured_at', { ascending: true })
        .limit(limit)
        .returns<
          {
            id: string;
            session_id: string;
            user_id: string;
            storage_path: string;
            format: string;
            captured_at: string;
            page_url: string | null;
            domain: string | null;
            page_title: string | null;
            analysis_attempts: number;
          }[]
        >();

      if (error) fail('Claiming pending screenshots', error);
      if (data.length === 0) return [];

      // Claimed before any work starts, so a second pass cannot pick up a
      // screenshot the first is still processing. A single worker makes this
      // belt-and-braces; it stops being so the moment a second one exists.
      const ids = data.map((row) => row.id);
      const { error: claimError } = await client
        .from('screenshots')
        .update({ analysis_status: 'processing' })
        .in('id', ids);
      if (claimError) fail('Marking screenshots as processing', claimError);

      return data.map<PendingScreenshot>((row) => ({
        id: row.id,
        sessionId: row.session_id,
        userId: row.user_id,
        storagePath: row.storage_path,
        format: row.format as ScreenshotFormat,
        capturedAt: new Date(row.captured_at).toISOString(),
        pageUrl: row.page_url,
        domain: row.domain,
        pageTitle: row.page_title,
        attempts: row.analysis_attempts + 1,
      }));
    },

    async setStatus(id, status, error) {
      const patch: Record<string, unknown> = {
        analysis_status: status,
        analysis_error: error ?? null,
      };
      // Counted on completion rather than on claim, so a worker killed
      // mid-analysis does not silently burn an attempt.
      if (status === 'failed' || status === 'completed') {
        const { data } = await client
          .from('screenshots')
          .select('analysis_attempts')
          .eq('id', id)
          .maybeSingle<{ analysis_attempts: number }>();
        patch.analysis_attempts = (data?.analysis_attempts ?? 0) + 1;
      }

      const { error: updateError } = await client.from('screenshots').update(patch).eq('id', id);
      if (updateError) fail('Updating screenshot status', updateError);
    },

    async list(userId, filter) {
      let query = client
        .from('screenshots')
        .select(
          'id, session_id, captured_at, format, width, height, byte_size, trigger, page_url, domain, page_title, analysis_status, analysis_error',
          { count: 'exact' },
        );

      if (userId !== null) query = query.eq('user_id', userId);
      if (filter.sessionId !== undefined) query = query.eq('session_id', filter.sessionId);
      if (filter.status !== undefined) query = query.eq('analysis_status', filter.status);
      if (filter.q !== undefined) {
        // Matching on the embedded ocr_results row keeps OCR text searchable
        // without the join escaping this query.
        query = query.or(
          `page_url.ilike.%${filter.q}%,page_title.ilike.%${filter.q}%,domain.ilike.%${filter.q}%,ocr_results.text.ilike.%${filter.q}%`,
        );
      }

      const { data, error, count } = await query
        .order('captured_at', { ascending: false })
        .range(filter.offset, filter.offset + filter.limit - 1)
        .returns<ScreenshotRow[]>();

      if (error) fail('Listing screenshots', error);
      if (data.length === 0) return { screenshots: [], total: count ?? 0 };

      const ids = data.map((row) => row.id);

      // Two extra queries for the page rather than one per screenshot.
      const [{ data: ocrRows }, { data: analysisRows }] = await Promise.all([
        client
          .from('ocr_results')
          .select('screenshot_id, text, word_count, mean_confidence, engine, duration_ms')
          .in('screenshot_id', ids)
          .returns<OcrRow[]>(),
        client
          .from('ai_analyses')
          .select('*')
          .in('screenshot_id', ids)
          .order('created_at', { ascending: false })
          .returns<AnalysisRow[]>(),
      ]);

      const ocrByScreenshot = new Map((ocrRows ?? []).map((row) => [row.screenshot_id, row]));
      const analysisByScreenshot = new Map<string, AnalysisRow>();
      for (const row of analysisRows ?? []) {
        // Ordered newest first, so the first seen for an id is the latest.
        if (!analysisByScreenshot.has(row.screenshot_id)) {
          analysisByScreenshot.set(row.screenshot_id, row);
        }
      }

      const screenshotList = data.map<Screenshot>((row) => {
        const ocrRow = ocrByScreenshot.get(row.id);
        const analysisRow = analysisByScreenshot.get(row.id);

        return {
          id: row.id,
          sessionId: row.session_id,
          capturedAt: new Date(row.captured_at).toISOString(),
          format: row.format as ScreenshotFormat,
          width: row.width,
          height: row.height,
          byteSize: row.byte_size,
          trigger: row.trigger as 'manual' | 'navigation',
          pageUrl: row.page_url,
          domain: row.domain,
          pageTitle: row.page_title,
          analysisStatus: row.analysis_status as AnalysisStatus,
          analysisError: row.analysis_error,
          ocr: ocrRow
            ? {
                text: ocrRow.text,
                wordCount: ocrRow.word_count,
                meanConfidence: ocrRow.mean_confidence,
                engine: ocrRow.engine,
                durationMs: ocrRow.duration_ms,
              }
            : null,
          analysis: analysisRow
            ? {
                id: analysisRow.id,
                screenshotId: analysisRow.screenshot_id,
                sessionId: analysisRow.session_id,
                provider: analysisRow.provider,
                model: analysisRow.model,
                createdAt: new Date(analysisRow.created_at).toISOString(),
                ...toVisionAnalysis(analysisRow),
              }
            : null,
        };
      });

      return { screenshots: screenshotList, total: count ?? screenshotList.length };
    },
  };

  const ocr: OcrRepository = {
    async upsert(screenshotId, result) {
      const { error } = await client.from('ocr_results').upsert(
        {
          screenshot_id: screenshotId,
          text: result.text,
          word_count: result.wordCount,
          mean_confidence: result.meanConfidence,
          engine: result.engine,
          duration_ms: result.durationMs,
        },
        { onConflict: 'screenshot_id' },
      );
      if (error) fail('Storing OCR output', error);
    },

    async findText(screenshotId) {
      const { data, error } = await client
        .from('ocr_results')
        .select('text')
        .eq('screenshot_id', screenshotId)
        .maybeSingle<{ text: string }>();

      if (error) fail('Reading OCR output', error);
      return data?.text ?? null;
    },
  };

  const analyses: AnalysisRepository = {
    async insert(analysis) {
      const { data, error } = await client
        .from('ai_analyses')
        .insert({
          screenshot_id: analysis.screenshotId,
          session_id: analysis.sessionId,
          provider: analysis.provider,
          model: analysis.model,
          page_type: analysis.page.pageType,
          category: analysis.page.category,
          purpose: analysis.page.purpose,
          important_elements: analysis.page.importantElements,
          visible_content_summary: analysis.page.visibleContentSummary ?? null,
          user_intent: analysis.activity.userIntent,
          current_task: analysis.activity.currentTask,
          activity_category: analysis.activity.activityCategory,
          summary: analysis.activity.summary,
          confidence: analysis.activity.confidence ?? null,
          raw: analysis.raw ?? null,
        })
        .select('id')
        .single<{ id: string }>();

      if (error) fail('Storing an analysis', error);
      return { id: data.id };
    },

    async listForSession(sessionId) {
      const { data, error } = await client
        .from('ai_analyses')
        .select('*, screenshots!inner(captured_at)')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .returns<(AnalysisRow & { screenshots: { captured_at: string } })[]>();

      if (error) fail('Listing session analyses', error);

      return data
        .map((row) => ({
          screenshotId: row.screenshot_id,
          capturedAt: new Date(row.screenshots.captured_at).toISOString(),
          analysis: toVisionAnalysis(row),
        }))
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    },

    async search(_userId, sessionId, q, limit) {
      let query = client.from('ai_analyses').select('*');

      if (sessionId !== undefined) query = query.eq('session_id', sessionId);
      query = query.or(
        `page_type.ilike.%${q}%,purpose.ilike.%${q}%,visible_content_summary.ilike.%${q}%,user_intent.ilike.%${q}%,current_task.ilike.%${q}%,summary.ilike.%${q}%`,
      );

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<AnalysisRow[]>();

      if (error) fail('Searching analyses', error);

      return data.map<StoredAnalysis>((row) => ({
        id: row.id,
        screenshotId: row.screenshot_id,
        sessionId: row.session_id,
        provider: row.provider,
        model: row.model,
        createdAt: new Date(row.created_at).toISOString(),
        ...toVisionAnalysis(row),
      }));
    },
  };

  const timeline: TimelineRepository = {
    async replaceForSession(userId, sessionId, activities) {
      const { error: deleteError } = await client
        .from('timeline_activities')
        .delete()
        .eq('session_id', sessionId);
      if (deleteError) fail('Clearing a session timeline', deleteError);

      if (activities.length === 0) return;

      const { error } = await client.from('timeline_activities').insert(
        activities.map((activity) => ({
          id: activity.id,
          session_id: sessionId,
          user_id: userId,
          started_at: activity.startedAt,
          ended_at: activity.endedAt,
          title: activity.title,
          description: activity.description,
          category: activity.category,
          domains: activity.domains,
          event_count: activity.eventCount,
          source: activity.source,
        })),
      );
      if (error) fail('Storing a session timeline', error);
    },

    async list(userId, sessionId, limit) {
      let query = client
        .from('timeline_activities')
        .select(
          'id, session_id, started_at, ended_at, title, description, category, domains, event_count, source',
        );

      if (userId !== null) query = query.eq('user_id', userId);
      if (sessionId !== undefined) query = query.eq('session_id', sessionId);

      const { data, error } = await query
        .order('started_at', { ascending: false })
        .limit(limit)
        .returns<
          {
            id: string;
            session_id: string;
            started_at: string;
            ended_at: string;
            title: string;
            description: string | null;
            category: string;
            domains: string[];
            event_count: number;
            source: string;
          }[]
        >();

      if (error) fail('Listing timeline activities', error);

      return data.map<TimelineActivity>((row) => ({
        id: row.id,
        sessionId: row.session_id,
        startedAt: new Date(row.started_at).toISOString(),
        endedAt: new Date(row.ended_at).toISOString(),
        title: row.title,
        description: row.description,
        category: row.category as ActivityCategory,
        domains: row.domains,
        eventCount: row.event_count,
        source: row.source as 'ai' | 'derived',
      }));
    },

    async search(userId, sessionId, q, limit) {
      let query = client
        .from('timeline_activities')
        .select(
          'id, session_id, started_at, ended_at, title, description, category, domains, event_count, source',
        )
        .or(`title.ilike.%${q}%,description.ilike.%${q}%`);

      if (userId !== null) query = query.eq('user_id', userId);
      if (sessionId !== undefined) query = query.eq('session_id', sessionId);

      const { data, error } = await query
        .order('started_at', { ascending: false })
        .limit(limit)
        .returns<
          {
            id: string;
            session_id: string;
            started_at: string;
            ended_at: string;
            title: string;
            description: string | null;
            category: string;
            domains: string[];
            event_count: number;
            source: string;
          }[]
        >();

      if (error) fail('Searching timeline activities', error);

      return data.map<TimelineActivity>((row) => ({
        id: row.id,
        sessionId: row.session_id,
        startedAt: new Date(row.started_at).toISOString(),
        endedAt: new Date(row.ended_at).toISOString(),
        title: row.title,
        description: row.description,
        category: row.category as ActivityCategory,
        domains: row.domains,
        eventCount: row.event_count,
        source: row.source as 'ai' | 'derived',
      }));
    },
  };

  return { screenshots, ocr, analyses, timeline };
}
