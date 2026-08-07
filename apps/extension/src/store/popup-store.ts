import { create } from 'zustand';
import { sendToBackground } from '../messaging/contract.js';
import type { AgentStatus } from '../messaging/contract.js';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChanged,
  saveSettings,
} from '../services/settings.js';
import type { ExtensionSettings } from '../services/settings.js';

interface PopupState {
  settings: ExtensionSettings;
  status: AgentStatus | null;
  loading: boolean;
  /** Set when a write fails, so the popup can say so rather than appear stuck. */
  error: string | null;

  initialize: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setTracking: (enabled: boolean) => Promise<void>;
  updateSettings: (patch: Partial<ExtensionSettings>) => Promise<void>;
  flushNow: () => Promise<void>;
}

export const usePopupStore = create<PopupState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  status: null,
  loading: true,
  error: null,

  initialize: async () => {
    const settings = await loadSettings();
    set({ settings, loading: false });

    // Tracking can also be toggled from another popup window or reset by the
    // background worker; mirroring storage keeps this view honest.
    onSettingsChanged((next) => set({ settings: next }));
    await get().refreshStatus();
  },

  refreshStatus: async () => {
    const status = await sendToBackground({ kind: 'GET_STATUS' });
    set({ status });
  },

  setTracking: async (enabled) => {
    // The background worker owns this transition: turning tracking on starts a
    // session and turning it off ends one, so it cannot be a plain storage write.
    const status = await sendToBackground({ kind: 'SET_TRACKING', enabled });
    if (!status) {
      set({ error: 'Background worker is not responding. Try reloading the extension.' });
      return;
    }
    set({ status, error: null });
  },

  updateSettings: async (patch) => {
    try {
      set({ settings: await saveSettings(patch), error: null });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : 'Could not save settings.' });
    }
  },

  flushNow: async () => {
    const status = await sendToBackground({ kind: 'FLUSH_NOW' });
    set({ status, error: status ? null : 'Could not reach the background worker.' });
  },
}));
