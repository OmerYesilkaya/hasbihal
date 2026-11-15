import { z } from 'zod';

/**
 * Machine-readable error codes. Clients branch on these, never on `message`, which is English
 * text for logs and developers; the UI shows its own translated copy per code.
 */
export const ErrorCode = z.enum([
  /** The request body, query, or params failed validation. `details` lists the issues. */
  'validation_failed',
  /** Missing, expired, or invalid credentials. */
  'unauthorized',
  /** Signed in, but not allowed to do this. */
  'forbidden',
  'not_found',
  /** The request conflicts with current state, e.g. a username that is taken. */
  'conflict',
  /** Too many attempts; retry later. */
  'rate_limited',
  /** The server or one of its dependencies (database) is unavailable. */
  'unavailable',
  /** An unexpected server error. Details are logged, never sent. */
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ValidationIssue = z.object({
  /** Where the issue is, e.g. `['body', 'username']`. */
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** The body of every non-2xx HTTP response. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    issues: z.array(ValidationIssue).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
