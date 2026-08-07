import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorResponse } from '@vab/types';
import { AppError, NotFoundError, ValidationError } from '../lib/errors.js';
import { describeError, describeStack } from '../lib/logger.js';
import type { Logger } from '../lib/logger.js';

/** Turns an unmatched route into a normal 404 rather than Express's HTML page. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFoundError(`No route matches ${req.method} ${req.path}`));
  };
}

/**
 * The single place a failure becomes an HTTP response.
 *
 * Every error is logged; 5xx responses carry no detail, because the detail is
 * for the operator reading logs, not for the caller. 4xx responses do carry
 * detail, since the caller is the only one who can fix them.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const appError = toAppError(error);

    const context = {
      method: req.method,
      // originalUrl, because req.path inside a mounted router omits the mount
      // point: a failure on /api/events would otherwise be logged as /events.
      path: req.originalUrl.split('?')[0],
      status: appError.status,
      code: appError.code,
      ...describeError(error),
    };

    if (appError.status >= 500) {
      // A stack is worth having for a server-side failure. A client sending a
      // malformed body is not a defect here, and its stack is only noise.
      logger.error('Request failed', { ...context, ...describeStack(error) });
    } else {
      logger.warn('Request rejected', context);
    }

    const body: ApiErrorResponse = {
      error: {
        code: appError.code,
        message:
          appError.status >= 500 ? 'The server could not complete the request.' : appError.message,
        ...(appError.status < 500 && appError.details !== undefined
          ? { details: appError.details }
          : {}),
      },
    };

    res.status(appError.status).json(body);
  };
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new ValidationError(
      'The request body did not match the expected shape.',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  // Express rejects malformed JSON before any handler sees it.
  if (error instanceof SyntaxError && 'body' in error) {
    return new ValidationError('The request body is not valid JSON.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Unexpected error.');
}
