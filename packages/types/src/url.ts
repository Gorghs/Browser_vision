/**
 * URL handling shared by the extension and the server.
 *
 * Both sides need the same answers to "is this trackable?" and "what is the
 * domain?" — the extension to avoid collecting, the server to avoid storing.
 */

/**
 * Schemes that never describe a page the user is browsing. Tracking them leaks
 * extension internals and local file paths without describing any activity.
 */
const UNTRACKABLE_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'chrome-untrusted:',
  'devtools:',
  'about:',
  'edge:',
  'file:',
  'view-source:',
  'data:',
  'blob:',
];

/** Extracts the hostname, lowercased and without a leading `www.`. */
export function extractDomain(url: string): string | undefined {
  try {
    const { hostname } = new URL(url);
    if (!hostname) return undefined;
    return hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** True when the URL describes a real page worth recording. */
export function isTrackableUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (UNTRACKABLE_SCHEMES.includes(parsed.protocol)) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Strips query strings and fragments.
 *
 * Query strings routinely carry session tokens, password-reset links, search
 * terms and email addresses. The path alone is enough to say which page was
 * visited, so the rest is dropped at the point of collection rather than being
 * sent and filtered later.
 */
export function sanitizeUrl(url: string, maxLength = 2048): string | undefined {
  try {
    const parsed = new URL(url);
    const sanitized = `${parsed.origin}${parsed.pathname}`;
    return sanitized.slice(0, maxLength);
  } catch {
    return undefined;
  }
}
