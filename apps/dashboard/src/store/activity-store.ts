import { create } from 'zustand';
import type {
  AnalyticsSummary,
  BrowserEvent,
  BrowserEventType,
  Screenshot,
  Session,
  TimelineActivity,
} from '@vab/types';
import {
  ApiError,
  fetchAnalyticsSummary,
  fetchEvents,
  fetchScreenshots,
  fetchSessions,
  fetchTimeline,
} from '../services/api.js';

export interface ActivityFilters {
  type: BrowserEventType | undefined;
  domain: string;
  sessionId: string | undefined;
}

/** Which read the main pane is showing. */
export type ActivityView = 'overview' | 'events' | 'timeline' | 'screenshots';

interface ActivityState {
  events: BrowserEvent[];
  sessions: Session[];
  total: number;
  activities: TimelineActivity[];
  screenshots: Screenshot[];
  screenshotTotal: number;
  summary: AnalyticsSummary | null;
  filters: ActivityFilters;
  view: ActivityView;
  loading: boolean;
  error: string | null;
  /** Null until the first successful load, so "never loaded" reads differently
   * from "loaded and empty". */
  lastLoadedAt: Date | null;

  load: () => Promise<void>;
  setFilter: <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => void;
  clearFilters: () => void;
  setView: (view: ActivityView) => void;
}

const EMPTY_FILTERS: ActivityFilters = { type: undefined, domain: '', sessionId: undefined };

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: [],
  sessions: [],
  total: 0,
  activities: [],
  screenshots: [],
  screenshotTotal: 0,
  summary: null,
  filters: EMPTY_FILTERS,
  view: 'overview',
  loading: false,
  error: null,
  lastLoadedAt: null,

  load: async () => {
    set({ loading: true, error: null });
    const { filters } = get();

    try {
      // Every pane reflects the same instant, rather than the timeline being a
      // request older than the events beneath it. The selected session scopes
      // each read; the type and domain filters only apply to the event table.
      const [events, sessions, timeline, screenshots, summary] = await Promise.all([
        fetchEvents({
          type: filters.type,
          domain: filters.domain.trim() || undefined,
          sessionId: filters.sessionId,
        }),
        fetchSessions(),
        fetchTimeline({ sessionId: filters.sessionId }),
        fetchScreenshots({ sessionId: filters.sessionId }),
        fetchAnalyticsSummary(),
      ]);

      set({
        events: events.events,
        total: events.total,
        sessions: sessions.sessions,
        activities: timeline.activities,
        screenshots: screenshots.screenshots,
        screenshotTotal: screenshots.total,
        summary: summary.summary,
        loading: false,
        lastLoadedAt: new Date(),
      });
    } catch (cause) {
      set({
        loading: false,
        error: cause instanceof ApiError ? cause.message : 'Something went wrong loading activity.',
      });
    }
  },

  setFilter: (key, value) => {
    set({ filters: { ...get().filters, [key]: value } });
    void get().load();
  },

  clearFilters: () => {
    set({ filters: EMPTY_FILTERS });
    void get().load();
  },

  setView: (view) => {
    set({ view });
  },
}));
