import { sendToBackground } from '../messaging/contract.js';
import type { InteractionReport } from '../messaging/contract.js';
import { loadSettings, onSettingsChanged } from '../services/settings.js';
import { describeSelection, describeTarget } from './describe-target.js';

/**
 * Content script.
 *
 * Reports page-level interactions to the background worker and nothing else. It
 * holds no business logic, talks to no network, and reads no field values.
 *
 * Listeners are only attached while the user has both tracking and interaction
 * tracking switched on, and are removed the moment either is turned off, so a
 * disabled extension is genuinely inert rather than merely quiet.
 */

/** Scroll fires continuously; one event per this many ms of scrolling is plenty. */
const SCROLL_IDLE_MS = 1000;

let detach: (() => void) | null = null;
let deepestScrollPercent = 0;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

function report(type: InteractionReport['type'], metadata: Record<string, unknown>): void {
  void sendToBackground({ kind: 'REPORT_INTERACTION', report: { type, metadata } });
}

function scrollPercent(): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return 0;
  return Math.min(100, Math.round((window.scrollY / scrollable) * 100));
}

function attach(captureSelectedText: boolean): () => void {
  const onClick = (event: MouseEvent): void => {
    const target = describeTarget(event.target);
    if (!target) return;
    report('CLICK', { ...target });
  };

  /**
   * Scroll is reported once the user stops, not while they move. A single
   * event carrying how far they got is more useful than fifty saying "still
   * scrolling", and it keeps one page from filling the whole batch.
   */
  const onScroll = (): void => {
    deepestScrollPercent = Math.max(deepestScrollPercent, scrollPercent());
    if (scrollTimer !== undefined) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      report('SCROLL', { depthPercent: deepestScrollPercent });
    }, SCROLL_IDLE_MS);
  };

  const onFocus = (): void => report('FOCUS', {});
  const onBlur = (): void => report('BLUR', {});

  const onSelectionEnd = (): void => {
    const selection = describeSelection(window.getSelection(), captureSelectedText);
    if (!selection) return;
    report('TEXT_SELECTED', { ...selection });
  };

  document.addEventListener('click', onClick, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  // `mouseup` rather than `selectionchange`, which fires for every character as
  // a selection is dragged out.
  document.addEventListener('mouseup', onSelectionEnd, { passive: true });

  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('mouseup', onSelectionEnd);
    if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  };
}

function applySettings(trackingEnabled: boolean, trackInteractions: boolean, selection: boolean) {
  const shouldTrack = trackingEnabled && trackInteractions;

  if (!shouldTrack) {
    detach?.();
    detach = null;
    return;
  }

  // Re-attach on any change so a selection-capture toggle takes effect at once.
  detach?.();
  detach = attach(selection);
}

void (async () => {
  const settings = await loadSettings();
  applySettings(settings.trackingEnabled, settings.trackInteractions, settings.captureSelectedText);

  onSettingsChanged((next) => {
    applySettings(next.trackingEnabled, next.trackInteractions, next.captureSelectedText);
  });
})();
