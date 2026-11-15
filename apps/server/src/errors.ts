import type { FastifyError, FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { ApiError, ErrorCode, ValidationIssue } from '@hasbihal/protocol';

/** An error with a known code and HTTP status. Its message is sent to the client as is. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly issues: ValidationIssue[] | undefined;

  constructor(statusCode: number, code: ErrorCode, message: string, issues?: ValidationIssue[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Parses part of a request with a zod schema, or throws a 400 `validation_failed` whose issue
 * paths start with `where` (e.g. `['body', 'username']`).
 */
export function parseRequest<T extends z.ZodType>(
  schema: T,
  value: unknown,
  where: 'body' | 'query' | 'params',
): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(
    400,
    'validation_failed',
    'The request is invalid.',
    result.error.issues.map((issue) => ({
      path: [where, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
      message: issue.message,
    })),
  );
}

/** Fastify's own 4xx errors (bad JSON, body too large, …) mapped to our codes. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    case 503:
      return 'unavailable';
    default:
      return status >= 500 ? 'internal' : 'validation_failed';
  }
}

export function errorBody(code: ErrorCode, message: string, issues?: ValidationIssue[]): ApiError {
  return { error: { code, message, ...(issues ? { issues } : {}) } };
}

/** Every error response uses the `ApiError` shape. Unexpected errors are logged, never sent. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.issues));
    }
    const status =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status < 500) {
      return reply.code(status).send(errorBody(codeForStatus(status), error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('internal', 'Something went wrong on the server.'));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(errorBody('not_found', `No route for ${request.method} ${request.url}.`)),
  );
}
