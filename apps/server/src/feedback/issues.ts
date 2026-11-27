import type { FeedbackDiagnostics, FeedbackKind } from '@hasbihal/protocol';

/** Where issues are opened: a GitHub repository, or a stand-in (tests). */
export interface IssueTracker {
  create(issue: NewIssue): Promise<{ number: number; url: string }>;
}

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

/** Every issue from the app carries `feedback`, so they can be listed together. */
const LABELS: Record<FeedbackKind, string[]> = {
  bug: ['feedback', 'bug'],
  idea: ['feedback', 'enhancement'],
  other: ['feedback'],
};

/**
 * `@name` would notify that GitHub account, from an issue nobody on GitHub wrote. A word joiner
 * after the `@` keeps the text as written but stops the mention.
 */
export const defuseMentions = (text: string) => text.replace(/@(?=[\p{L}\p{N}_-])/gu, '@⁠');

/**
 * The public issue for one piece of feedback (A56): what they wrote and, if they agreed, the
 * versions involved. Never who sent it. The comment at the end ties it to its row.
 */
export function issueFor(feedback: {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  diagnostics: FeedbackDiagnostics | null;
  serverVersion: string;
}): NewIssue {
  const parts = [defuseMentions(feedback.body)];
  if (feedback.diagnostics) {
    parts.push(
      [
        '| | |',
        '| --- | --- |',
        `| App | ${cell(feedback.diagnostics.appVersion)} |`,
        `| OS | ${cell(feedback.diagnostics.os)} |`,
        `| Server | ${cell(feedback.serverVersion)} |`,
      ].join('\n'),
    );
  }
  parts.push(
    '<sub>Sent from the Hasbihal app. The sender is not named.</sub>',
    `<!-- hasbihal-feedback:${feedback.id} -->`,
  );
  return {
    title: defuseMentions(feedback.title),
    body: parts.join('\n\n'),
    labels: LABELS[feedback.kind],
  };
}

/** Text that stays inside one Markdown table cell. */
const cell = (text: string) => defuseMentions(text).replace(/[|\n\r]/g, ' ');

/**
 * Opens issues in `repo` (`owner/name`) with a fine-grained token that may only write that
 * repository's issues. The token stays on the server; the app never sees it.
 */
export function githubIssues({
  repo,
  token,
  apiUrl,
}: {
  repo: string;
  token: string;
  /** `https://api.github.com`, or a stand-in in tests. */
  apiUrl: string;
}): IssueTracker {
  return {
    async create(issue) {
      const response = await fetch(new URL(`/repos/${repo}/issues`, apiUrl), {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'hasbihal-server',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify(issue),
        signal: AbortSignal.timeout(15_000),
      });
      // Thrown, so the job queue tries again later (and logs it if it never works).
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`GitHub refused the issue: ${String(response.status)} ${detail}`);
      }
      const created = (await response.json()) as { number: number; html_url: string };
      return { number: created.number, url: created.html_url };
    },
  };
}
