import { useEffect, useRef, useState } from 'react';
import type { BrowserEvent, Screenshot, StoredAnalysis, TimelineActivity } from '@vab/types';
import { formatPath, formatTime, humanizeCategory, humanizeEventType } from '../features/format.js';

interface SearchViewProps {
  query: string;
  running: boolean;
  error: string | null;
  events: BrowserEvent[];
  screenshots: Screenshot[];
  activities: TimelineActivity[];
  analyses: StoredAnalysis[];
  onSearch: (query: string) => void;
  onClear: () => void;
}

/** Debounce settles typing into a single request, so a phrase isn't sent whole. */
const DEBOUNCE_MS = 350;

export function SearchView({
  query,
  running,
  error,
  events,
  screenshots,
  activities,
  analyses,
  onSearch,
  onClear,
}: SearchViewProps) {
  const [draft, setDraft] = useState(query);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;

    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => onSearch(trimmed), DEBOUNCE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [draft, onSearch]);

  const hasResults =
    events.length > 0 || screenshots.length > 0 || activities.length > 0 || analyses.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = draft.trim();
          if (trimmed.length > 0) onSearch(trimmed);
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search events, screenshots, AI summaries…"
          aria-label="Search query"
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[var(--color-accent)] focus:outline-none"
        />
        {query.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            Clear
          </button>
        ) : null}
      </form>

      {error !== null ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </p>
      ) : null}

      {running ? (
        <p className="text-sm text-slate-400">Searching for “{query}”…</p>
      ) : query.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center text-sm text-slate-400">
          Search matches events by URL, domain and title; screenshots by page fields and OCR text;
          AI analyses by summary, intent and purpose; and timeline activities by title and
          description.
        </p>
      ) : !hasResults ? (
        <p className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center text-sm text-slate-400">
          No matches for “{query}”.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-xs text-slate-500">
            {events.length + screenshots.length + activities.length + analyses.length} match
            {events.length + screenshots.length + activities.length + analyses.length === 1
              ? ''
              : 'es'}{' '}
            for “{query}”
          </p>

          {events.length > 0 ? (
            <section aria-labelledby="search-events-heading">
              <h3
                id="search-events-heading"
                className="mb-2 text-xs font-medium tracking-wide text-slate-400 uppercase"
              >
                Events ({events.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-slate-100">
                        {humanizeEventType(event.type)}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {event.domain !== undefined ? `${event.domain} · ` : ''}
                      {formatPath(event.url)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {screenshots.length > 0 ? (
            <section aria-labelledby="search-screenshots-heading">
              <h3
                id="search-screenshots-heading"
                className="mb-2 text-xs font-medium tracking-wide text-slate-400 uppercase"
              >
                Screenshots ({screenshots.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {screenshots.map((screenshot) => (
                  <li
                    key={screenshot.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2"
                  >
                    <p className="truncate text-sm text-slate-100">
                      {screenshot.pageTitle ?? screenshot.domain ?? 'Untitled page'}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {screenshot.domain !== undefined ? `${screenshot.domain} · ` : ''}
                      {formatPath(screenshot.pageUrl ?? undefined)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activities.length > 0 ? (
            <section aria-labelledby="search-activities-heading">
              <h3
                id="search-activities-heading"
                className="mb-2 text-xs font-medium tracking-wide text-slate-400 uppercase"
              >
                Timeline ({activities.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {activities.map((activity) => (
                  <li
                    key={activity.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2"
                  >
                    <p className="text-sm text-slate-100">{activity.title}</p>
                    {activity.description !== null ? (
                      <p className="mt-1 text-xs text-slate-400">{activity.description}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {humanizeCategory(activity.category)} · {activity.domains.join(', ')}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {analyses.length > 0 ? (
            <section aria-labelledby="search-analyses-heading">
              <h3
                id="search-analyses-heading"
                className="mb-2 text-xs font-medium tracking-wide text-slate-400 uppercase"
              >
                AI analysis ({analyses.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {analyses.map((analysis) => (
                  <li
                    key={analysis.screenshotId}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2"
                  >
                    <p className="text-sm text-slate-100">
                      {analysis.activity.currentTask ?? analysis.page.pageType}
                    </p>
                    {analysis.activity.summary !== null ? (
                      <p className="mt-1 text-xs text-slate-400">{analysis.activity.summary}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {analysis.page.category !== null
                        ? humanizeCategory(analysis.page.category)
                        : ''}
                      {analysis.provider !== undefined ? ` · ${analysis.provider}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
