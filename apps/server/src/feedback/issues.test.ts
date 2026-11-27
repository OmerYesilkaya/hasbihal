import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { defuseMentions, githubIssues, issueFor } from './issues.ts';

const feedback = {
  id: '0193a6f0-0000-7000-8000-000000000000',
  kind: 'bug' as const,
  title: 'Mesaj gelince liste zıplıyor',
  body: 'Yeni mesajda liste önce yukarı kayıyor.',
  diagnostics: null,
  serverVersion: '0.8.0',
};

describe('the issue for a piece of feedback (A56)', () => {
  it('is what they wrote, labelled by kind, tied to its row', () => {
    const issue = issueFor(feedback);
    expect(issue.title).toBe(feedback.title);
    expect(issue.body).toContain(feedback.body);
    expect(issue.body).toContain(`<!-- hasbihal-feedback:${feedback.id} -->`);
    expect(issue.labels).toEqual(['feedback', 'bug']);
    expect(issueFor({ ...feedback, kind: 'idea' }).labels).toEqual(['feedback', 'enhancement']);
    expect(issueFor({ ...feedback, kind: 'other' }).labels).toEqual(['feedback']);
  });

  it('lists the versions only when they agreed to send them', () => {
    expect(issueFor(feedback).body).not.toContain('| App |');
    const body = issueFor({
      ...feedback,
      diagnostics: { appVersion: '0.8.0', os: 'macOS 15.1 | x\ny' },
    }).body;
    expect(body).toContain('| App | 0.8.0 |');
    // A cell stays one cell, whatever is in it.
    expect(body).toContain('| OS | macOS 15.1   x y |');
    expect(body).toContain('| Server | 0.8.0 |');
  });

  it('notifies nobody on GitHub', () => {
    const issue = issueFor({
      ...feedback,
      title: '@octocat bak',
      body: 'Selam @octocat, @ ve a@b',
    });
    expect(issue.title).not.toMatch(/@\w/);
    expect(issue.body).not.toMatch(/@\w/);
    // The text still reads the same.
    expect(issue.body.replaceAll('⁠', '')).toContain('Selam @octocat, @ ve a@b');
    expect(defuseMentions('@çay')).toBe('@⁠çay');
  });
});

describe('the feedback repository setting', () => {
  it('needs both the repository and the token', () => {
    expect(loadConfig({}).feedbackGithub).toBeUndefined();
    // As the production compose file passes them when they're not set.
    expect(
      loadConfig({ FEEDBACK_GITHUB_REPO: '', FEEDBACK_GITHUB_TOKEN: '' }).feedbackGithub,
    ).toBeUndefined();
    expect(
      loadConfig({ FEEDBACK_GITHUB_REPO: 'owner/repo', FEEDBACK_GITHUB_TOKEN: 't' }).feedbackGithub,
    ).toEqual({ repo: 'owner/repo', token: 't', apiUrl: 'https://api.github.com' });
    expect(() => loadConfig({ FEEDBACK_GITHUB_REPO: 'owner/repo' })).toThrow(/go together/);
    expect(() =>
      loadConfig({ FEEDBACK_GITHUB_REPO: 'nope', FEEDBACK_GITHUB_TOKEN: 't' }),
    ).toThrow();
  });

  it('never talks to a stand-in GitHub in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FEEDBACK_GITHUB_API_URL: 'http://127.0.0.1:1',
        AUTH_SIGNING_KEY: 'x',
        LIVEKIT_API_KEY: 'k',
        LIVEKIT_API_SECRET: 's',
        GOOGLE_CLIENT_ID: 'g',
      }),
    ).toThrow(/never allowed in production/);
  });
});

/** A stand-in for GitHub's API on this machine: answers with `status`, records each request. */
async function fakeGithub(status: number) {
  const requests: { url: string; headers: IncomingMessage['headers']; body: unknown }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(body) });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        status === 201
          ? JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' })
          : '{"message":"Bad credentials"}',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    apiUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('GitHub issues', () => {
  it('opens one in the repository with the token, as GitHub asks', async () => {
    const github = await fakeGithub(201);
    try {
      const issues = githubIssues({ repo: 'o/r', token: 'secret', apiUrl: github.apiUrl });
      const issue = { title: 't', body: 'b', labels: ['feedback'] };
      expect(await issues.create(issue)).toEqual({
        number: 7,
        url: 'https://github.com/o/r/issues/7',
      });
      expect(github.requests).toMatchObject([
        {
          url: '/repos/o/r/issues',
          headers: { authorization: 'Bearer secret', 'x-github-api-version': '2022-11-28' },
          body: issue,
        },
      ]);
    } finally {
      await github.close();
    }
  });

  it('fails when GitHub refuses, so the job tries again', async () => {
    const github = await fakeGithub(401);
    try {
      const issues = githubIssues({ repo: 'o/r', token: 'bad', apiUrl: github.apiUrl });
      await expect(issues.create({ title: 't', body: 'b', labels: [] })).rejects.toThrow(/401/);
    } finally {
      await github.close();
    }
  });
});
