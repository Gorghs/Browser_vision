import { useState } from 'react';
import type { BrowserEvent, Screenshot, Session, TimelineActivity } from '@vab/types';
import {
  formatDate,
  formatSessionLength,
  formatTime,
  humanizeCategory,
} from '../features/format.js';
import { EventTable } from './EventTable.js';
import { ScreenshotGallery } from './ScreenshotGallery.js';
import { Timeline } from './Timeline.js';

interface SessionExplorerProps {
  session: Session | undefined;
  events: BrowserEvent[];
  activities: TimelineActivity[];
  screenshots: Screenshot[];
  screenshotTotal: number;
}

type Tab = 'timeline' | 'events' | 'screenshots' | 'ai';

const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'events', label: 'Events' },
  { id: 'screenshots', label: 'Screenshots' },
  { id: 'ai', label: 'AI analysis' },
];

/**
 * A session deep dive: one place to see everything that happened in it.
 *
 * The session list feeds a single `sessionId` filter to the shared endpoints,
 * so every tab here reflects the same session, and the "AI analysis" tab reads
 * the stored analyses embedded in each screenshot.
 */
export function SessionExplorer({
  session,
  events,
  activities,
  screenshots,
  screenshotTotal,
}: SessionExplorerProps) {
  const [tab, setTab] = useState<Tab>('timeline');

  if (session === undefined) {
    return (
      <p className="text-sm text-slate-500">
        Select a session from the list to explore everything that happened in it.
      </p>
    );
  }

  const analyses = screenshots.filter((screenshot) => screenshot.analysis !== null);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-slate-100">
              {formatDate(session.startedAt)} {formatTime(session.startedAt)}
            </span>
            {session.endedAt === undefined ? (
              <span className="text-[11px] text-emerald-400">live</span>
            ) : (
              <span className="text-[11px] text-slate-500">
                {formatSessionLength(session.startedAt, session.endedAt)}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400">
            {session.eventCount} event{session.eventCount === 1 ? '' : 's'}
            {session.lastEventAt !== null ? ` · last ${formatTime(session.lastEventAt)}` : ''}
          </span>
        </div>
      </section>

      <nav className="flex gap-1" aria-label="Session sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === id
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'timeline' ? <Timeline activities={activities} /> : null}
      {tab === 'events' ? <EventTable events={events} /> : null}
      {tab === 'screenshots' ? (
        <ScreenshotGallery screenshots={screenshots} total={screenshotTotal} />
      ) : null}
      {tab === 'ai' ? <AiAnalysis analyses={analyses} /> : null}
    </div>
  );
}

/** The stored AI understanding for each analysed screenshot in the session. */
function AiAnalysis({ analyses }: { analyses: Screenshot[] }) {
  if (analyses.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No AI analysis yet for this session. Analysed screenshots appear here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {analyses.map((screenshot) => {
        const analysis = screenshot.analysis;
        if (analysis === null) return null;
        return (
          <li
            key={screenshot.id}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-3"
          >
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-100">
                {screenshot.pageTitle ?? screenshot.domain ?? 'Untitled page'}
              </span>
              <span className="text-[11px] text-slate-500">
                {humanizeCategory(analysis.activity.activityCategory)}
                {analysis.activity.confidence !== undefined
                  ? ` · ${Math.round(analysis.activity.confidence * 100)}% confidence`
                  : ''}
              </span>
            </div>
            <p className="mb-2 text-sm text-slate-200">{analysis.activity.summary}</p>
            <dl className="flex flex-col gap-1 text-xs text-slate-400">
              <div>
                <dt className="inline font-medium text-slate-300">Task: </dt>
                <dd className="inline">{analysis.activity.currentTask}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-slate-300">Intent: </dt>
                <dd className="inline">{analysis.activity.userIntent}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-slate-300">Page: </dt>
                <dd className="inline">
                  {analysis.page.pageType} — {analysis.page.purpose}
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
