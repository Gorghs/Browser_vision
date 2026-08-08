/** Presentation helpers, kept out of components so they can be tested directly. */

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Compact duration: "45s", "12m", "1h 20m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;

  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

export function formatSessionLength(startedAt: string, endedAt: string | undefined): string {
  const end = endedAt === undefined ? Date.now() : new Date(endedAt).getTime();
  return formatDuration(end - new Date(startedAt).getTime());
}

/**
 * Shortens a URL for display.
 *
 * The domain is shown separately in the table, so the path carries the
 * information here.
 */
export function formatPath(url: string | undefined): string {
  if (url === undefined) return '—';
  try {
    const { pathname } = new URL(url);
    return pathname === '/' ? '/' : pathname;
  } catch {
    return url;
  }
}

/** Turns SESSION_STARTED into "Session started". */
export function humanizeEventType(type: string): string {
  const words = type.toLowerCase().split('_');
  const [first, ...rest] = words;
  if (first === undefined) return type;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** Turns documentation into "Documentation". */
export function humanizeCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Compact byte size: "412 B", "87 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
