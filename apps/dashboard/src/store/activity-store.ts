import { create } from 'zustand';
import type { BrowserEvent, BrowserEventType, Session } from '@vab/types';
import { ApiError, fetchEvents, fetchSessions } from '../services/api.js';

export interface ActivityFilters {
  type: BrowserEventType | undefined;
  domain: string;
  sessionId: string | undefined;
}

interface ActivityState {
  events: BrowserEvent[];
  sessions: Session[];
  total: number;
  filters: ActivityFilters;
  loading: boolean;
  error: string | null;
  /** Null until the first successful load, so "never loaded" reads differently
   * from "loaded and empty". */
  lastLoadedAt: Date | null;

  load: () => Promise<void>;
  setFilter: <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => void;
  clearFilters: () => void;
}

const EMPTY_FILTERS: ActivityFilters = { type: undefined, domain: '', sessionId: undefined };

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: [],
  sessions: [],
  total: 0,
  filters: EMPTY_FILTERS,
  loading: false,
  error: null,
  lastLoadedAt: null,

  load: async () => {
    set({ loading: true, error: null });
    const { filters } = get();

    try {
      // Both views reflect the same instant, rather than the sessions list
      // being a request older than the events beneath it.
      const [events, sessions] = await Promise.all([
        fetchEvents({
          type: filters.type,
          domain: filters.domain.trim() || undefined,
          sessionId: filters.sessionId,
        }),
        fetchSessions(),
      ]);

      set({
        events: events.events,
        total: events.total,
        sessions: sessions.sessions,
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
}));
