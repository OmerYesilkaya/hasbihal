// A stand-in for GitHub's issues API, for the end-to-end tests (DECISIONS A56): the server opens
// feedback issues here, and tests read them back through `/test/issues`.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The repository and token the e2e server is configured with. */
export const E2E_FEEDBACK_REPO = 'hasbihal/feedback-e2e';
export const E2E_GITHUB_TOKEN = 'e2e-token';

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      resolve(body);
    });
  });

export async function startFakeGithub(): Promise<{ url: string; stop: () => Promise<void> }> {
  const issues: FakeIssue[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.method === 'POST' && request.url === `/repos/${E2E_FEEDBACK_REPO}/issues`) {
        if (request.headers.authorization !== `Bearer ${E2E_GITHUB_TOKEN}`) {
          json(401, { message: 'Bad credentials' });
          return;
        }
        const { title, body, labels } = JSON.parse(await readBody(request)) as Omit<
          FakeIssue,
          'number'
        >;
        const issue = { number: issues.length + 1, title, body, labels };
        issues.push(issue);
        json(201, {
          number: issue.number,
          html_url: `https://github.com/${E2E_FEEDBACK_REPO}/issues/${String(issue.number)}`,
        });
      } else if (request.method === 'GET' && request.url === '/test/issues') {
        json(200, issues);
      } else {
        json(404, { message: 'Not Found' });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
