import type { AgentStatus } from '../../messaging/contract.js';

function formatClock(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '—';
  const minutes = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
  if (minutes < 1) return 'just started';
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

export function StatusPanel({ status }: { status: AgentStatus | null }) {
  if (!status) {
    return (
      <p className="rounded-md bg-[var(--color-surface-raised)] px-3 py-2 text-xs text-slate-400">
        Waiting for the background worker…
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-[var(--color-surface-raised)] px-3 py-3 text-xs">
      <div>
        <dt className="text-slate-400">Session</dt>
        <dd className="text-slate-100">
          {status.sessionId ? `${status.sessionId.slice(0, 8)}…` : 'none'}
        </dd>
      </div>
      <div>
        <dt className="text-slate-400">Running for</dt>
        <dd className="text-slate-100">{formatDuration(status.sessionStartedAt)}</dd>
      </div>
      <div>
        <dt className="text-slate-400">Sent</dt>
        <dd className="text-slate-100">{status.deliveredEvents}</dd>
      </div>
      <div>
        <dt className="text-slate-400">Queued</dt>
        <dd className="text-slate-100">{status.queuedEvents}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-slate-400">Last delivery</dt>
        <dd className="text-slate-100">{formatClock(status.lastFlushAt)}</dd>
      </div>
      {status.lastError ? (
        <div className="col-span-2">
          <dt className="text-amber-400">Last error</dt>
          <dd className="break-words text-amber-200">{status.lastError}</dd>
        </div>
      ) : null}
    </dl>
  );
}
