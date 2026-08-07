import type { BrowserEvent } from '@vab/types';
import { formatPath, formatTime, humanizeEventType } from '../features/format.js';

/** Groups events by kind, so a table scan does not require reading every row. */
const TYPE_TONE: Record<string, string> = {
  SESSION_STARTED: 'bg-emerald-500/15 text-emerald-300',
  SESSION_ENDED: 'bg-slate-500/15 text-slate-300',
  NAVIGATION: 'bg-blue-500/15 text-blue-300',
  PAGE_LOADED: 'bg-blue-500/10 text-blue-200',
  TAB_CREATED: 'bg-violet-500/15 text-violet-300',
  TAB_CLOSED: 'bg-violet-500/10 text-violet-200',
  TAB_ACTIVATED: 'bg-violet-500/10 text-violet-200',
  WINDOW_FOCUS_CHANGED: 'bg-amber-500/10 text-amber-200',
  CLICK: 'bg-amber-500/15 text-amber-300',
  SCROLL: 'bg-slate-500/10 text-slate-300',
  TEXT_SELECTED: 'bg-pink-500/15 text-pink-300',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        TYPE_TONE[type] ?? 'bg-slate-500/15 text-slate-300'
      }`}
    >
      {humanizeEventType(type)}
    </span>
  );
}

export function EventTable({ events }: { events: BrowserEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center text-sm text-slate-400">
        No events match these filters yet. Turn tracking on in the extension popup and browse a
        little.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs text-slate-400">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Domain</th>
            <th className="px-3 py-2 font-medium">Page</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-raised)]"
            >
              <td className="px-3 py-2 align-top font-mono text-xs whitespace-nowrap text-slate-400">
                {formatTime(event.timestamp)}
              </td>
              <td className="px-3 py-2 align-top">
                <TypeBadge type={event.type} />
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap text-slate-200">
                {event.domain ?? '—'}
              </td>
              <td className="max-w-md px-3 py-2 align-top">
                <div className="truncate text-slate-300" title={event.url ?? ''}>
                  {formatPath(event.url)}
                </div>
                {event.title !== undefined ? (
                  <div className="truncate text-xs text-slate-500">{event.title}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
