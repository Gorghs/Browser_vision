import type { AnalyticsSummary } from '@vab/types';
import { humanizeCategory } from '../features/format.js';

interface OverviewProps {
  summary: AnalyticsSummary | null;
}

/**
 * The landing view: headline counts plus the aggregates that describe what the
 * extension has been recording — which sites get the most attention and what
 * kind of activity dominates.
 */
export function Overview({ summary }: OverviewProps) {
  if (summary === null) {
    return <p className="text-sm text-slate-500">Loading overview…</p>;
  }

  const { totals, topDomains, categories } = summary;
  const statCards = [
    { label: 'Events', value: totals.events },
    { label: 'Sessions', value: totals.sessions },
    { label: 'Live now', value: totals.liveSessions },
    { label: 'Screenshots', value: totals.screenshots },
    { label: 'Analysed', value: totals.analysedScreenshots },
  ];

  const topEventCount = topDomains[0]?.events ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-4"
          >
            <div className="text-2xl font-semibold text-slate-100">{card.value}</div>
            <div className="text-xs text-slate-400">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            Top sites by activity
          </h3>
          {topDomains.length === 0 ? (
            <p className="text-sm text-slate-500">No site activity recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {topDomains.map(({ domain, events }) => (
                <li key={domain} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm text-slate-200" title={domain}>
                    {domain}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)]/70"
                      style={{
                        width: topEventCount === 0 ? '0%' : `${(events / topEventCount) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs text-slate-400">{events}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            Activity by type
          </h3>
          {categories.length === 0 ? (
            <p className="text-sm text-slate-500">
              No analysed activity yet — categories appear once screenshots are analysed.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {categories.map(({ category, count }) => (
                <li key={category} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-200">{humanizeCategory(category)}</span>
                  <span className="text-xs text-slate-400">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
