import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedbackReceipt, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { IssueTracker, NewIssue } from './issues.ts';
import { FEEDBACK_ISSUE_JOB, FEEDBACK_PER_HOUR } from './service.ts';

/** GitHub, as the tests play it: records the issues, and can be down. */
function fakeIssues() {
  const opened: NewIssue[] = [];
  let down = false;
  const tracker: IssueTracker = {
    create(issue) {
      if (down) return Promise.reject(new Error('GitHub is down'));
      opened.push(issue);
      const number = opened.length;
      return Promise.resolve({ number, url: `https://github.com/o/r/issues/${String(number)}` });
    },
  };
  return {
    tracker,
    opened,
    setDown(value: boolean) {
      down = value;
    },
  };
}

const as = (who: SignedIn) => who.tokens.accessToken;
const feedback = {
  kind: 'bug',
  title: 'Liste zıplıyor',
  body: 'Yeni mesaj gelince liste bir an yukarı kayıyor.',
  diagnostics: { appVersion: '0.8.0', os: 'macOS 15.1.0' },
};

describe('feedback, published as issues (A56)', () => {
  let h: Harness;
  const issues = fakeIssues();
  beforeAll(async () => {
    h = await startHarness({ issues: issues.tracker });
  });
  afterAll(async () => {
    await h.close();
  });

  it('keeps it, then opens a public issue that does not name the sender', async () => {
    const member = await h.signUp();
    const res = await h.request('POST', '/feedback', as(member), feedback);
    expect(res.statusCode, res.body).toBe(201);
    const { id } = FeedbackReceipt.parse(res.json());

    await h.app.jobs.runDue();
    const issue = issues.opened.at(-1);
    expect(issue?.title).toBe(feedback.title);
    expect(issue?.labels).toEqual(['feedback', 'bug']);
    expect(issue?.body).toContain(feedback.body);
    expect(issue?.body).toContain('| OS | macOS 15.1.0 |');
    for (const who of [member.user.displayName, member.user.username, member.account.email])
      expect(issue?.body).not.toContain(who);

    const row = await h.testDb.db
      .selectFrom('feedback')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      author_id: member.user.id,
      kind: 'bug',
      diagnostics: feedback.diagnostics,
      issue_number: issues.opened.length,
    });
  });

  it('waits out GitHub being down, and never opens the same issue twice', async () => {
    const member = await h.signUp();
    issues.setDown(true);
    const res = await h.request('POST', '/feedback', as(member), {
      ...feedback,
      diagnostics: null,
    });
    const { id } = FeedbackReceipt.parse(res.json());
    const before = issues.opened.length;
    await h.app.jobs.runDue();
    expect(issues.opened.length).toBe(before);
    // The failed try waits for its retry; make it due now, with GitHub back. By the database's
    // clock, which decides what is due (the computer's may run ahead of it).
    await h.testDb.db
      .updateTable('jobs')
      .set({ run_at: sql<Date>`now()` })
      .execute();
    issues.setDown(false);
    await h.app.jobs.runDue();
    expect(issues.opened.length).toBe(before + 1);
    expect(issues.opened.at(-1)?.body).not.toContain('| App |');

    // A second run for the same feedback (a retry after a lost reply) does nothing.
    await enqueueJob(h.testDb.db, FEEDBACK_ISSUE_JOB, { feedbackId: id });
    await h.app.jobs.runDue();
    expect(issues.opened.length).toBe(before + 1);
  });

  it(`takes ${String(FEEDBACK_PER_HOUR)} an hour from each member`, async () => {
    const member = await h.signUp();
    for (let i = 0; i < FEEDBACK_PER_HOUR; i++)
      expect((await h.request('POST', '/feedback', as(member), feedback)).statusCode).toBe(201);
    const refused = await h.request('POST', '/feedback', as(member), feedback);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    // Someone else still can.
    const other = await h.signUp();
    expect((await h.request('POST', '/feedback', as(other), feedback)).statusCode).toBe(201);
  });

  it('refuses what is too short, too long, or of no known kind', async () => {
    const member = await h.signUp();
    for (const bad of [
      { ...feedback, title: 'ab' },
      { ...feedback, body: 'kısa' },
      { ...feedback, body: 'x'.repeat(5001) },
      { ...feedback, kind: 'praise' },
    ])
      expect((await h.request('POST', '/feedback', as(member), bad)).statusCode).toBe(400);
  });

  it('is for members only', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/feedback', payload: feedback });
    expect(res.statusCode).toBe(401);
  });
});

describe('feedback, without a repository to publish to', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('is kept, and nothing is queued', async () => {
    const member = await h.signUp();
    const res = await h.request('POST', '/feedback', as(member), feedback);
    expect(res.statusCode).toBe(201);
    const jobs = await h.testDb.db
      .selectFrom('jobs')
      .select('kind')
      .where('kind', '=', FEEDBACK_ISSUE_JOB)
      .execute();
    expect(jobs).toEqual([]);
  });
});
