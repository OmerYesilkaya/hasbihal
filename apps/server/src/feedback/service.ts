import type { Kysely } from 'kysely';
import { z } from 'zod';
import { newId } from '@hasbihal/core';
import type { FeedbackReceipt, SendFeedbackRequest } from '@hasbihal/protocol';
import type { Database } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { enqueueJob, type JobHandler } from '../jobs/queue.ts';
import { issueFor, type IssueTracker } from './issues.ts';

export const FEEDBACK_ISSUE_JOB = 'feedback_issue';

/** Each member may send this many in an hour: plenty for people, not for a stuck key. */
export const FEEDBACK_PER_HOUR = 5;

/**
 * Keeps the feedback and, when issues are on, queues its issue in the same transaction: it is
 * published once, after it is safely stored, and retried while GitHub is unreachable.
 */
export async function sendFeedback(
  db: Kysely<Database>,
  authorId: string,
  request: z.output<typeof SendFeedbackRequest>,
  { publish }: { publish: boolean },
): Promise<FeedbackReceipt> {
  return db.transaction().execute(async (trx) => {
    // One at a time per member, so two quick sends can't both slip under the limit.
    await trx
      .selectFrom('users')
      .select('id')
      .where('id', '=', authorId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const { recent } = await trx
      .selectFrom('feedback')
      .select((eb) => eb.fn.countAll<string>().as('recent'))
      .where('author_id', '=', authorId)
      .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
      .executeTakeFirstOrThrow();
    if (Number(recent) >= FEEDBACK_PER_HOUR)
      throw new AppError(429, 'rate_limited', 'Too much feedback in the last hour.');

    const id = newId();
    await trx
      .insertInto('feedback')
      .values({
        id,
        author_id: authorId,
        kind: request.kind,
        title: request.title,
        body: request.body,
        diagnostics: request.diagnostics ? JSON.stringify(request.diagnostics) : null,
      })
      .execute();
    if (publish) await enqueueJob(trx, FEEDBACK_ISSUE_JOB, { feedbackId: id });
    return { id };
  });
}

/** Opens the feedback's public issue (A56), once: a retry after it exists does nothing. */
export function feedbackIssueJob(deps: {
  db: Kysely<Database>;
  issues: IssueTracker;
  serverVersion: string;
}): JobHandler {
  return async (payload) => {
    const { feedbackId } = z.object({ feedbackId: z.string() }).parse(payload);
    const feedback = await deps.db
      .selectFrom('feedback')
      .select(['id', 'kind', 'title', 'body', 'diagnostics', 'issue_number'])
      .where('id', '=', feedbackId)
      .executeTakeFirst();
    // Gone, or its issue already exists (a retry after a reply that got lost).
    if (feedback?.issue_number !== null) return;
    const issue = await deps.issues.create(
      issueFor({ ...feedback, serverVersion: deps.serverVersion }),
    );
    await deps.db
      .updateTable('feedback')
      .set({ issue_number: issue.number, issue_url: issue.url })
      .where('id', '=', feedbackId)
      .execute();
  };
}
