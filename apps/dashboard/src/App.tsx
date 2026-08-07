import { useEffect } from 'react';
import { EventTable } from './components/EventTable.js';
import { FilterBar } from './components/FilterBar.js';
import { SessionList } from './components/SessionList.js';
import { useActivityStore } from './store/activity-store.js';

/** Activity keeps arriving while the page is open, so it refreshes itself. */
const REFRESH_MS = 5000;

export function App() {
  const {
    events,
    sessions,
    total,
    filters,
    loading,
    error,
    lastLoadedAt,
    load,
    setFilter,
    clearFilters,
  } = useActivityStore();

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Browser activity</h1>
          <p className="text-sm text-slate-400">
            {lastLoadedAt === null
              ? 'Loading…'
              : `${total} event${total === 1 ? '' : 's'} recorded`}
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {loading
            ? 'Refreshing…'
            : lastLoadedAt
              ? `Updated ${lastLoadedAt.toLocaleTimeString()}`
              : ''}
        </span>
      </header>

      {error !== null ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </p>
      ) : null}

      <FilterBar filters={filters} onChange={setFilter} onClear={clearFilters} />

      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <aside className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Sessions</h2>
          <SessionList
            sessions={sessions}
            selectedId={filters.sessionId}
            onSelect={(sessionId) => setFilter('sessionId', sessionId)}
          />
        </aside>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            {filters.sessionId === undefined ? 'Recent events' : 'Events in this session'}
          </h2>
          <EventTable events={events} />
        </section>
      </div>
    </div>
  );
}
