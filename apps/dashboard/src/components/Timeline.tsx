import type { TimelineActivity } from '@vab/types';
import { formatDate, formatTime, humanizeCategory } from '../features/format.js';

/** Colours by category, so a scan reads like a grouped list rather than a wall of text. */
const CATEGORY_TONE: Record<string, string> = {
  development: 'bg-blue-500/15 text-blue-300',
  documentation: 'bg-cyan-500/15 text-cyan-300',
  research: 'bg-violet-500/15 text-violet-300',
  communication: 'bg-emerald-500/15 text-emerald-300',
  social: 'bg-pink-500/15 text-pink-300',
  entertainment: 'bg-amber-500/15 text-amber-300',
  shopping: 'bg-orange-500/15 text-orange-300',
  productivity: 'bg-teal-500/15 text-teal-300',
  news: 'bg-red-500/15 text-red-300',
  education: 'bg-indigo-500/15 text-indigo-300',
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        CATEGORY_TONE[category] ?? 'bg-slate-500/15 text-slate-300'
      }`}
    >
      {humanizeCategory(category)}
    </span>
  );
}

export function Timeline({ activities }: { activities: TimelineActivity[] }) {
  if (activities.length === 0) {
    return (
      <p className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center text-sm text-slate-400">
        No timeline activities yet. Activities appear once a session has enough events to describe.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {activities.map((activity) => (
        <li
          key={activity.id}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs whitespace-nowrap text-slate-400">
                {formatDate(activity.startedAt)} {formatTime(activity.startedAt)}
                {activity.endedAt !== activity.startedAt ? `–${formatTime(activity.endedAt)}` : ''}
              </span>
              <CategoryBadge category={activity.category} />
            </div>
            <span
              className={`text-[11px] font-medium ${
                activity.source === 'ai' ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {activity.source === 'ai' ? 'AI understanding' : 'Derived from events'}
            </span>
          </div>

          <h3 className="mt-2 text-sm font-medium text-slate-100">{activity.title}</h3>

          {activity.description !== null ? (
            <p className="mt-1 text-sm text-slate-300">{activity.description}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {activity.domains.map((domain) => (
              <span
                key={domain}
                className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
              >
                {domain}
              </span>
            ))}
            <span>
              {String(activity.eventCount)} event{activity.eventCount === 1 ? '' : 's'}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
