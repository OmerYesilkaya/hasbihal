import { z } from 'zod';
import { Id } from './id.ts';

// Feedback from the app (DECISIONS A56): a bug, an idea, or anything else, which becomes a public
// GitHub issue without the sender's name.

export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_BODY_MAX = 5000;

const text = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(min).max(max));

export const FeedbackKind = z.enum(['bug', 'idea', 'other']);
export type FeedbackKind = z.infer<typeof FeedbackKind>;

/** What the app adds when the sender agrees: enough to reproduce a bug, nothing about them. */
export const FeedbackDiagnostics = z.object({
  appVersion: z.string().min(1).max(40),
  /** e.g. `macOS 15.1.0`. */
  os: z.string().min(1).max(80),
});
export type FeedbackDiagnostics = z.infer<typeof FeedbackDiagnostics>;

export const SendFeedbackRequest = z.object({
  kind: FeedbackKind,
  title: text(3, FEEDBACK_TITLE_MAX),
  body: text(10, FEEDBACK_BODY_MAX),
  diagnostics: FeedbackDiagnostics.nullable().default(null),
});
export type SendFeedbackRequest = z.input<typeof SendFeedbackRequest>;

export const FeedbackReceipt = z.object({ id: Id });
export type FeedbackReceipt = z.infer<typeof FeedbackReceipt>;
