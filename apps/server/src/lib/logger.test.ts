import { describe, expect, it } from 'vitest';
import { createLogger, describeError } from './logger.js';

function capture(level?: 'debug' | 'info' | 'warn' | 'error') {
  const lines: string[] = [];
  const logger = createLogger({
    ...(level !== undefined ? { level } : {}),
    write: (line) => lines.push(line),
    now: () => new Date('2026-08-07T10:00:00.000Z'),
  });
  return {
    logger,
    lines,
    parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('output', () => {
  it('writes one JSON object per line', () => {
    const { logger, parsed } = capture();

    logger.info('something happened', { count: 3 });

    expect(parsed()[0]).toEqual({
      time: '2026-08-07T10:00:00.000Z',
      level: 'info',
      message: 'something happened',
      count: 3,
    });
  });

  it('merges bindings from a child logger', () => {
    const { logger, parsed } = capture();

    logger.child({ requestId: 'abc' }).info('handled');

    expect(parsed()[0]).toMatchObject({ requestId: 'abc' });
  });
});

describe('levels', () => {
  it('suppresses entries below the configured level', () => {
    const { logger, lines } = capture('warn');

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(lines).toHaveLength(2);
  });

  it('defaults to info, so debug is off unless asked for', () => {
    const { logger, lines } = capture();

    logger.debug('noise');

    expect(lines).toEqual([]);
  });
});

describe('describeError', () => {
  it('does not collide with the log entry message', () => {
    const { logger, parsed } = capture();

    logger.error('Request failed', describeError(new Error('the underlying detail')));

    expect(parsed()[0]).toMatchObject({
      message: 'Request failed',
      errorName: 'Error',
      errorMessage: 'the underlying detail',
    });
  });

  it('handles a thrown value that is not an Error', () => {
    expect(describeError('just a string')).toMatchObject({
      errorName: 'UnknownError',
      errorMessage: 'just a string',
    });
  });

  it('includes an underlying cause when there is one', () => {
    const error = new Error('outer');
    error.cause = new Error('inner');

    expect(describeError(error).errorCause).toContain('inner');
  });
});
