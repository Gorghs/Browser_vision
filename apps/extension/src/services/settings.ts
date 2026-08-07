/**
 * Extension settings, persisted in `chrome.storage.local`.
 *
 * Deliberately `local` rather than `sync`: these describe how one browser is
 * monitored and include a backend credential. Neither should be replicated to
 * every machine the user signs into Chrome on.
 */
export interface ExtensionSettings {
  /**
   * Master switch. Off until the user turns it on — the extension collects
   * nothing on install, so consent is an action rather than an opt-out.
   */
  trackingEnabled: boolean;
  /** Page-level interaction events: clicks, scroll, focus, blur. */
  trackInteractions: boolean;
  /**
   * Whether a text selection's content is recorded, as opposed to only the fact
   * that a selection happened. Off by default: selections are page content, and
   * everything else the extension collects is metadata.
   */
  captureSelectedText: boolean;
  /**
   * Whether tab screenshots are captured at all.
   *
   * Off by default and gated on a separate Chrome permission the user grants
   * when switching it on: a screenshot is categorically more revealing than the
   * metadata everything else collects, so it is a second, explicit decision.
   */
  visualCaptureEnabled: boolean;
  /** Capture on navigation, as opposed to only when asked from the popup. */
  captureOnNavigation: boolean;
  /** Backend base URL, no trailing slash. */
  apiBaseUrl: string;
  /** Shared key the backend expects in `x-api-key`. */
  apiKey: string;
  /** Domains never collected from, matched on the domain and its subdomains. */
  blockedDomains: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  trackingEnabled: false,
  trackInteractions: true,
  captureSelectedText: false,
  visualCaptureEnabled: false,
  captureOnNavigation: true,
  apiBaseUrl: 'http://localhost:3000',
  apiKey: '',
  blockedDomains: [],
};

const STORAGE_KEY = 'settings';

/** Reads settings, falling back to defaults for anything not yet stored. */
export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value: unknown = stored[STORAGE_KEY];
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  // Merging over the defaults means a settings object written by an older
  // version of the extension gains new keys instead of yielding undefined.
  return { ...DEFAULT_SETTINGS, ...(value as Partial<ExtensionSettings>) };
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Notifies on any settings change, including ones made in another context. */
export function onSettingsChanged(listener: (settings: ExtensionSettings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local' || !(STORAGE_KEY in changes)) return;
    const next = changes[STORAGE_KEY]?.newValue as Partial<ExtensionSettings> | undefined;
    listener({ ...DEFAULT_SETTINGS, ...next });
  };

  chrome.storage.onChanged.addListener(handler);
  return () => {
    chrome.storage.onChanged.removeListener(handler);
  };
}

/**
 * True when the domain, or any parent of it, is blocked.
 *
 * Blocking `example.com` also blocks `mail.example.com`, which is what a user
 * adding a domain to the list expects.
 */
export function isDomainBlocked(domain: string | undefined, blockedDomains: string[]): boolean {
  if (!domain) return false;
  const target = domain.toLowerCase();
  return blockedDomains.some((blocked) => {
    const entry = blocked
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    if (!entry) return false;
    return target === entry || target.endsWith(`.${entry}`);
  });
}
