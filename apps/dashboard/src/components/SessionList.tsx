import type { Session } from '@vab/types';
import { formatDate, formatSessionLength, formatTime } from '../features/format.js';

interface SessionListProps {
  sessions: Session[];
  selectedId: string | undefined;
  onSelect: (sessionId: string | undefined) => void;
}

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="text-sm text-slate-500">No sessions recorded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {sessions.map((session) => {
        const selected = session.id === selectedId;
        const running = session.endedAt === undefined;

        return (
          <li key={session.id}>
            <button
              type="button"
              // Clicking the selected session clears the filter, so there is no
              // separate "show all" control to hunt for.
              onClick={() => onSelect(selected ? undefined : session.id)}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                selected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                  : 'border-transparent bg-[var(--color-surface-raised)] hover:border-[var(--color-border-subtle)]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-slate-200">
                  {formatDate(session.startedAt)} {formatTime(session.startedAt)}
                </span>
                {running ? (
                  <span className="text-[11px] text-emerald-400">live</span>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    {formatSessionLength(session.startedAt, session.endedAt)}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {session.eventCount} event{session.eventCount === 1 ? '' : 's'}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
