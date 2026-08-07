/**
 * Structured logging.
 *
 * One line of JSON per event, so logs stay greppable and machine-readable
 * without pulling in a logging framework for what the project actually needs.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Injected so tests can capture output instead of writing to stdout. */
  write?: (line: string) => void;
  bindings?: Record<string, unknown>;
  now?: () => Date;
}

/**
 * Turns an unknown thrown value into something worth putting in a log line.
 *
 * Keys are prefixed rather than named `message`, which would collide with the
 * log entry's own message — a validation error would then replace the line's
 * summary with its entire serialized issue list.
 */
export function describeError(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) {
    return {
      errorName: cause.name,
      errorMessage: cause.message,
      ...(cause.cause !== undefined ? { errorCause: String(cause.cause) } : {}),
    };
  }
  return { errorName: 'UnknownError', errorMessage: String(cause) };
}

/** The stack, kept separate so only server-side failures pay for it. */
export function describeStack(cause: unknown): Record<string, unknown> {
  return cause instanceof Error && cause.stack !== undefined ? { stack: cause.stack } : {};
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const bindings = options.bindings ?? {};
  const now = options.now ?? (() => new Date());
  const threshold = LOG_LEVELS.indexOf(level);

  const log = (entryLevel: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (LOG_LEVELS.indexOf(entryLevel) < threshold) return;
    write(
      JSON.stringify({
        time: now().toISOString(),
        level: entryLevel,
        message,
        ...bindings,
        ...context,
      }),
    );
  };

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
    child: (extra) => createLogger({ ...options, level, bindings: { ...bindings, ...extra } }),
  };
}
