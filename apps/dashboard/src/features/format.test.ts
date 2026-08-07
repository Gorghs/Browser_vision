import { describe, expect, it } from 'vitest';
import { formatDuration, formatPath, formatSessionLength, humanizeEventType } from './format.js';

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [1_000, '1s'],
    [45_000, '45s'],
    [60_000, '1m'],
    [12 * 60_000, '12m'],
    [60 * 60_000, '1h 0m'],
    [80 * 60_000, '1h 20m'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('formatSessionLength', () => {
  it('measures a closed session between its endpoints', () => {
    expect(formatSessionLength('2026-08-07T10:00:00.000Z', '2026-08-07T10:42:00.000Z')).toBe('42m');
  });

  it('measures a running session up to now', () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();

    expect(formatSessionLength(startedAt, undefined)).toBe('5m');
  });
});

describe('formatPath', () => {
  it('shows the path, since the domain has its own column', () => {
    expect(formatPath('https://github.com/vercel/next.js/issues/12')).toBe(
      '/vercel/next.js/issues/12',
    );
  });

  it('shows a bare slash for a site root', () => {
    expect(formatPath('https://example.com/')).toBe('/');
  });

  it('shows a dash when there is no url', () => {
    expect(formatPath(undefined)).toBe('—');
  });

  it('falls back to the raw value when it will not parse', () => {
    expect(formatPath('not a url')).toBe('not a url');
  });
});

describe('humanizeEventType', () => {
  it.each([
    ['SESSION_STARTED', 'Session started'],
    ['WINDOW_FOCUS_CHANGED', 'Window focus changed'],
    ['CLICK', 'Click'],
  ])('turns %s into %s', (type, expected) => {
    expect(humanizeEventType(type)).toBe(expected);
  });
});
