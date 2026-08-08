import type { Screenshot, StoredAnalysis } from '@vab/types';
import { formatBytes, formatDate, formatTime, humanizeCategory } from '../features/format.js';
import { ScreenshotImage } from './ScreenshotImage.js';

interface ScreenshotCardProps {
  screenshot: Screenshot;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting to be analysed',
  processing: 'Analysing…',
  completed: 'Analysed',
  failed: 'Analysis failed',
};

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-slate-500/15 text-slate-300',
  processing: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        STATUS_TONE[status] ?? 'bg-slate-500/15 text-slate-300'
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ScreenshotCard({ screenshot }: ScreenshotCardProps) {
  const title = screenshot.pageTitle ?? screenshot.domain ?? 'Untitled capture';

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <ScreenshotImage id={screenshot.id} alt={title} />

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-slate-100" title={title}>
              {title}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {screenshot.domain ?? '—'} · {formatDate(screenshot.capturedAt)}{' '}
              {formatTime(screenshot.capturedAt)} · {formatBytes(screenshot.byteSize)}
            </p>
          </div>
          <StatusBadge status={screenshot.analysisStatus} />
        </div>

        {screenshot.analysisStatus === 'failed' ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
            {screenshot.analysisError ?? 'The screenshot could not be analysed.'}
          </p>
        ) : null}

        {screenshot.analysisStatus === 'pending' || screenshot.analysisStatus === 'processing' ? (
          <p className="text-xs text-slate-500">
            OCR and AI understanding appear here once the analysis pipeline has run.
          </p>
        ) : null}

        {screenshot.analysis !== null ? <Understanding analysis={screenshot.analysis} /> : null}

        {screenshot.ocr !== null ? (
          <OcrText
            text={screenshot.ocr.text}
            wordCount={screenshot.ocr.wordCount}
            meanConfidence={screenshot.ocr.meanConfidence}
            engine={screenshot.ocr.engine}
          />
        ) : null}
      </div>
    </article>
  );
}

function Understanding({ analysis }: { analysis: StoredAnalysis }) {
  return (
    <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <h4 className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        AI understanding
      </h4>

      <p className="mt-2 text-sm font-medium text-slate-100">{analysis.activity.summary}</p>

      <dl className="mt-2 flex flex-col gap-1 text-xs">
        <Row label="Page type" value={analysis.page.pageType} />
        <Row label="Category" value={humanizeCategory(analysis.page.category)} />
        <Row label="Purpose" value={analysis.page.purpose} />
        <Row label="Intent" value={analysis.activity.userIntent} />
        <Row label="Current task" value={analysis.activity.currentTask} />
      </dl>

      {analysis.page.importantElements.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {analysis.page.importantElements.map((element) => (
            <span
              key={element}
              className="rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[11px] text-slate-300"
            >
              {element}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[11px] text-slate-500">
        {analysis.provider} · {analysis.model}
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-slate-300">{value}</dd>
    </div>
  );
}

function OcrText({
  text,
  wordCount,
  meanConfidence,
  engine,
}: {
  text: string;
  wordCount: number;
  meanConfidence: number | null;
  engine: string;
}) {
  return (
    <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <h4 className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">OCR text</h4>
      <p className="mt-2 max-h-40 overflow-y-auto text-xs leading-relaxed text-slate-300">{text}</p>
      <p className="mt-2 text-[11px] text-slate-500">
        {wordCount} words
        {meanConfidence !== null
          ? ` · ${String(Math.round(meanConfidence * 100))}% confidence`
          : ''}
        {engine !== '' ? ` · ${engine}` : ''}
      </p>
    </section>
  );
}
