import { useEffect } from 'react';
import { EventTable } from './components/EventTable.js';
import { FilterBar } from './components/FilterBar.js';
import { Overview } from './components/Overview.js';
import { ScreenshotGallery } from './components/ScreenshotGallery.js';
import { SearchView } from './components/SearchView.js';
import { SessionExplorer } from './components/SessionExplorer.js';
import { SessionList } from './components/SessionList.js';
import { Timeline } from './components/Timeline.js';
import { formatDate } from './features/format.js';
import { useActivityStore } from './store/activity-store.js';
import type { ActivityView } from './store/activity-store.js';

/** Activity keeps arriving while the page is open, so it refreshes itself. */
const REFRESH_MS = 5000;

const VIEWS: { id: ActivityView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'session', label: 'Session' },
  { id: 'search', label: 'Search' },
  { id: 'events', label: 'Events' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'screenshots', label: 'Screenshots' },
];

export function App() {
  const {
    events,
    sessions,
    total,
    activities,
    screenshots,
    screenshotTotal,
    summary,
    searchResults,
    searchRunning,
    filters,
    view,
    loading,
    error,
    lastLoadedAt,
    load,
    setFilter,
    clearFilters,
    setView,
    runSearch,
    clearSearch,
  } = useActivityStore();

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const selectedSession = sessions.find((session) => session.id === filters.sessionId);

  const count =
    view === 'overview'
      ? `${summary?.totals.events ?? 0} event${summary?.totals.events === 1 ? '' : 's'}`
      : view === 'events' || view === 'session'
        ? `${total} event${total === 1 ? '' : 's'}`
        : view === 'timeline'
          ? `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`
          : view === 'screenshots'
            ? `${screenshotTotal} capture${screenshotTotal === 1 ? '' : 's'}`
            : searchResults === null
              ? 'search'
              : `${searchResults.events.length + searchResults.screenshots.length + searchResults.activities.length + searchResults.analyses.length} match${
                  searchResults.events.length +
                    searchResults.screenshots.length +
                    searchResults.activities.length +
                    searchResults.analyses.length ===
                  1
                    ? ''
                    : 'es'
                }`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Browser activity</h1>
          <p className="text-sm text-slate-400">
            {lastLoadedAt === null ? 'Loading…' : `${count} recorded`}
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

      <nav className="flex gap-1" aria-label="Views">
        {VIEWS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === id
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'events' ? (
        <FilterBar filters={filters} onChange={setFilter} onClear={clearFilters} />
      ) : null}

      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <aside className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Sessions</h2>
          <SessionList
            sessions={sessions}
            selectedId={filters.sessionId}
            onSelect={(sessionId) => {
              setFilter('sessionId', sessionId);
              // Picking a session opens its deep dive; picking it again clears
              // the selection and returns to the current pane.
              if (sessionId !== undefined) setView('session');
            }}
          />
        </aside>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            {view === 'overview'
              ? 'Overview'
              : view === 'session'
                ? selectedSession === undefined
                  ? 'Session explorer'
                  : `Session from ${formatDate(selectedSession.startedAt)}`
                : view === 'events'
                  ? filters.sessionId === undefined
                    ? 'Recent events'
                    : 'Events in this session'
                  : view === 'timeline'
                    ? filters.sessionId === undefined
                      ? 'Recent timeline'
                      : 'Timeline for this session'
                    : view === 'screenshots'
                      ? filters.sessionId === undefined
                        ? 'Recent screenshots'
                        : 'Screenshots in this session'
                      : 'Search'}
          </h2>

          {view === 'overview' ? <Overview summary={summary} /> : null}
          {view === 'session' ? (
            <SessionExplorer
              session={selectedSession}
              events={events}
              activities={activities}
              screenshots={screenshots}
              screenshotTotal={screenshotTotal}
            />
          ) : null}
          {view === 'events' ? <EventTable events={events} /> : null}
          {view === 'timeline' ? <Timeline activities={activities} /> : null}
          {view === 'screenshots' ? (
            <ScreenshotGallery screenshots={screenshots} total={screenshotTotal} />
          ) : null}
          {view === 'search' ? (
            <SearchView
              query={searchResults?.query ?? ''}
              running={searchRunning}
              error={error}
              events={searchResults?.events ?? []}
              screenshots={searchResults?.screenshots ?? []}
              activities={searchResults?.activities ?? []}
              analyses={searchResults?.analyses ?? []}
              onSearch={(query) => void runSearch(query)}
              onClear={clearSearch}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
