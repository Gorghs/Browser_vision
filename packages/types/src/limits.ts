/**
 * Size limits applied to collected data.
 *
 * Deliberately in their own module with no imports. The content script runs on
 * every page the user visits and needs these numbers; importing them from the
 * package root would drag the whole validation library along with them.
 *
 * Values are truncated at the collection site rather than rejected on arrival,
 * so one unusual page never costs a whole batch.
 */
export const EVENT_LIMITS = {
  urlMaxLength: 2048,
  titleMaxLength: 512,
  /** Events accepted in a single ingest request. */
  batchMaxSize: 200,
  /** Characters of user-selected text retained on a TEXT_SELECTED event. */
  selectionMaxLength: 280,
  /** Characters of accessible label text retained on a CLICK event. */
  clickLabelMaxLength: 120,
} as const;
