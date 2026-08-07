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
  setVisualCapture: (enabled: boolean) => Promise<void>;
  captureNow: () => Promise<void>;
  flushNow: () => Promise<void>;
}

/**
 * The origins a screenshot needs.
 *
 * Requested from the popup rather than the background worker, because Chrome
 * only shows a permission prompt in response to a user gesture — and a
 * permission for reading page pixels should require one.
 */
const CAPTURE_ORIGINS = ['http://*/*', 'https://*/*'];

/** Why a capture was refused, in words the user can act on. */
const CAPTURE_REFUSALS: Record<string, string> = {
  'tracking-disabled': 'Turn tracking on first.',
  'visual-capture-disabled': 'Turn visual capture on first.',
  'permission-not-granted': 'Chrome has not granted screenshot permission.',
  'untrackable-url': 'This page cannot be captured.',
  'blocked-domain': 'This domain is on your blocklist.',
  'no-session': 'No session is running.',
  'session-limit': 'This session has reached its capture limit.',
  'too-large': 'The captured image was too large to send.',
  'upload-failed': 'The backend did not accept the screenshot.',
  'capture-failed': 'Chrome refused to capture this tab.',
  'no-active-tab': 'No active tab to capture.',
};

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

  /**
   * Turns visual capture on, asking Chrome for the permission it needs first.
   *
   * The setting is only written if the permission is granted, so the popup can
   * never show capture as enabled while Chrome would refuse every attempt.
   * Switching it off hands the permission back rather than merely ignoring it.
   */
  setVisualCapture: async (enabled) => {
    if (!enabled) {
      await saveSettings({ visualCaptureEnabled: false });
      await chrome.permissions.remove({ origins: CAPTURE_ORIGINS }).catch(() => false);
      set({ settings: await loadSettings(), error: null });
      await get().refreshStatus();
      return;
    }

    const granted = await chrome.permissions
      .request({ origins: CAPTURE_ORIGINS })
      .catch(() => false);
    if (!granted) {
      set({ error: 'Chrome denied permission to capture pages, so visual capture stays off.' });
      return;
    }

    set({ settings: await saveSettings({ visualCaptureEnabled: true }), error: null });
    await get().refreshStatus();
  },

  captureNow: async () => {
    const result = await sendToBackground({ kind: 'CAPTURE_NOW' });
    if (result?.captured === true) {
      set({ error: null });
      await get().refreshStatus();
      return;
    }
    const reason = result?.reason;
    set({
      error:
        reason !== undefined
          ? (CAPTURE_REFUSALS[reason] ?? `Capture failed: ${reason}`)
          : 'Could not reach the background worker.',
    });
  },

  flushNow: async () => {
    const status = await sendToBackground({ kind: 'FLUSH_NOW' });
    set({ status, error: status ? null : 'Could not reach the background worker.' });
  },
}));
