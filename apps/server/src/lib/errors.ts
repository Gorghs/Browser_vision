/**
 * Application errors.
 *
 * Every failure the API reports deliberately carries a machine-readable code, so
 * the extension can tell a retryable problem from a permanent one without
 * parsing prose.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_FAILED', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'A valid API key is required.') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

/**
 * A failure in the storage layer.
 *
 * Reported as 503 rather than 500 because it is usually transient — Supabase
 * unreachable, a connection reset — and the extension retries on 5xx, which is
 * exactly the behaviour wanted here.
 */
export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(503, 'STORAGE_UNAVAILABLE', message);
    // The standard Error.cause, so the underlying driver error survives into
    // the logs without inventing a second field for it.
    this.cause = cause;
  }
}
