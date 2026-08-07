import { BROWSER_EVENT_TYPES } from '@vab/types';
import type { BrowserEventType } from '@vab/types';
import { humanizeEventType } from '../features/format.js';
import type { ActivityFilters } from '../store/activity-store.js';

interface FilterBarProps {
  filters: ActivityFilters;
  onChange: <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => void;
  onClear: () => void;
}

const inputClass =
  'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-sm text-slate-200';

export function FilterBar({ filters, onChange, onClear }: FilterBarProps) {
  const active =
    filters.type !== undefined || filters.domain !== '' || filters.sessionId !== undefined;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">Event type</span>
        <select
          className={inputClass}
          value={filters.type ?? ''}
          onChange={(event) =>
            onChange(
              'type',
              event.target.value === '' ? undefined : (event.target.value as BrowserEventType),
            )
          }
        >
          <option value="">All types</option>
          {BROWSER_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanizeEventType(type)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">Domain</span>
        <input
          className={inputClass}
          value={filters.domain}
          placeholder="github.com"
          spellCheck={false}
          onChange={(event) => onChange('domain', event.target.value)}
        />
      </label>

      {active ? (
        <button
          type="button"
          onClick={onClear}
          className="px-1 pb-2 text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
