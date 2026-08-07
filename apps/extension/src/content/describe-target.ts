import { EVENT_LIMITS } from '@vab/types/limits';

/**
 * Turns a clicked element into a short, non-sensitive description.
 *
 * This is the single most privacy-sensitive function in the extension: it is the
 * only place that reads anything from a page's DOM. The rules it enforces:
 *
 * - never read the value of any field the user can type into;
 * - never describe an element inside a form control or a password field;
 * - take label text from what is already visible on screen, and truncate it.
 */

/** Elements whose contents are, or may become, something the user typed. */
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export interface TargetDescription {
  tag: string;
  role?: string;
  /** Visible label text, truncated. Absent for anything field-like. */
  label?: string;
  /** Destination of the nearest enclosing link, with the query string removed. */
  href?: string;
  /** True when the click landed on or inside a form field. */
  isFormField: boolean;
}

function isFieldLike(element: Element): boolean {
  return element.matches(FIELD_SELECTOR) || element.closest(FIELD_SELECTOR) !== null;
}

/**
 * Visible text only.
 *
 * `innerText` rather than `textContent` because it respects CSS: text hidden
 * with `display: none` is not something the user saw, and may be there
 * precisely because it is not meant to be read.
 */
function visibleLabel(element: HTMLElement): string | undefined {
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) return aria.slice(0, EVENT_LIMITS.clickLabelMaxLength);

  const text = element.innerText.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.slice(0, EVENT_LIMITS.clickLabelMaxLength);
}

function linkHref(element: Element): string | undefined {
  const anchor = element.closest('a');
  const href = anchor?.getAttribute('href');
  if (!href) return undefined;

  try {
    const resolved = new URL(href, document.baseURI);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    // Query strings on links carry tracking parameters and, on some sites,
    // identifiers for whatever the link points at.
    return `${resolved.origin}${resolved.pathname}`.slice(0, EVENT_LIMITS.urlMaxLength);
  } catch {
    return undefined;
  }
}

export function describeTarget(target: EventTarget | null): TargetDescription | null {
  if (!(target instanceof Element)) return null;

  const tag = target.tagName.toLowerCase();
  const role = target.getAttribute('role') ?? undefined;

  if (isFieldLike(target)) {
    // Record that a field was clicked, and nothing whatsoever about it.
    return { tag, isFormField: true, ...(role !== undefined ? { role } : {}) };
  }

  const label = target instanceof HTMLElement ? visibleLabel(target) : undefined;
  const href = linkHref(target);

  return {
    tag,
    isFormField: false,
    ...(role !== undefined ? { role } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(href !== undefined ? { href } : {}),
  };
}

/**
 * Describes a text selection.
 *
 * Selections inside form fields are ignored entirely — that is the user's own
 * typing, which this extension does not collect under any setting.
 */
export function describeSelection(
  selection: Selection | null,
  includeText: boolean,
): { length: number; text?: string } | null {
  if (!selection || selection.isCollapsed) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  const anchor = selection.anchorNode;
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
  if (anchorElement && isFieldLike(anchorElement)) return null;

  if (!includeText) return { length: text.length };
  return { length: text.length, text: text.slice(0, EVENT_LIMITS.selectionMaxLength) };
}
