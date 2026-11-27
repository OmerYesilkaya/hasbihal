import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { newId } from '@hasbihal/core';
import type { FakeIssue } from './fake-github.ts';
import { Attachment, GoogleSignInResult, Message, Room, type Role } from '@hasbihal/protocol';

// Shared by every spec: each test makes its own people and rooms through the API (milliseconds),
// so any one of them runs on its own (`pnpm test:e2e -g hangout`), in any order.

export const SERVER_DIR = path.resolve(import.meta.dirname, '../../server');
const APP_DIR = path.resolve(import.meta.dirname, '..');

const serverUrl = () => process.env.E2E_SERVER_URL ?? '';
const googleUrl = () => process.env.E2E_GOOGLE_URL ?? '';

/** The server command that lets an address in (A25), exactly as the owner runs it. */
export async function allowEmailOnServer(
  email: string,
  role: Role = 'member',
  databaseUrl = process.env.E2E_DATABASE_URL,
): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['src/cli/allow-email.ts', email, ...(role === 'admin' ? ['--admin'] : [])],
    { cwd: SERVER_DIR, env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  return stdout;
}

// ---- Google, as the stand-in plays it (fake-google.ts) -----------------------------------------

/** Gives someone a Google account the stand-in signs in as. */
export async function googleAccount(
  account: { email: string; name: string; picture?: string },
  url = googleUrl(),
): Promise<void> {
  const response = await fetch(new URL('/test/accounts', url), {
    method: 'POST',
    body: JSON.stringify(account),
  });
  if (!response.ok) throw new Error(`google account: ${String(response.status)}`);
}

/** An ID token for this account, as the app gets it from the browser. */
export async function googleIdToken(email: string, url = googleUrl()): Promise<string> {
  const response = await fetch(new URL(`/test/id-token?email=${encodeURIComponent(email)}`, url));
  return ((await response.json()) as { idToken: string }).idToken;
}

/** Signs in through the API with a Google account: what the app does after the browser. */
export async function signInWithGoogle(email: string, url = serverUrl(), google = googleUrl()) {
  const response = await fetch(new URL('/auth/google', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: await googleIdToken(email, google), deviceName: 'e2e' }),
  });
  if (!response.ok) throw new Error(`sign-in: ${String(response.status)} ${await response.text()}`);
  return GoogleSignInResult.parse(await response.json());
}

let counter = 0;
/** A Gmail address no other test uses: tests share the database. */
export const uniqueEmail = (name: string) =>
  `${name
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[^a-z]/g, '')
    .slice(0, 10)}.${String(process.pid % 1000)}.${String(++counter)}@gmail.com`;

// ---- GitHub, as the stand-in plays it (fake-github.ts) -----------------------------------------

/** The issues the server has opened so far, oldest first. */
export async function githubIssues(): Promise<FakeIssue[]> {
  const response = await fetch(new URL('/test/issues', process.env.E2E_GITHUB_URL ?? ''));
  return (await response.json()) as FakeIssue[];
}

// ---- the server's API, for setting the scene -------------------------------------------------

async function call<T>(
  method: string,
  url: string,
  token: string | null,
  body?: unknown,
  parse?: { parse: (v: unknown) => T },
): Promise<T> {
  const response = await fetch(new URL(url, serverUrl()), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body instanceof FormData || body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${String(response.status)}: ${text}`);
  return parse ? parse.parse(text ? JSON.parse(text) : null) : (undefined as T);
}

/** A person in a test: what the API returned, and the Google account they sign in with. */
export interface Person {
  id: string;
  username: string;
  displayName: string;
  email: string;
  token: string;
}

let seed: Promise<string> | undefined;
/** The seed admin's access token (made in global setup), for letting people in and making rooms. */
function seedToken(): Promise<string> {
  seed ??= signInWithGoogle(process.env.E2E_SEED_EMAIL ?? '').then((result) => {
    if (result.status !== 'signed_in') throw new Error('the seed admin is not signed in');
    return result.tokens.accessToken;
  });
  return seed;
}

/** Puts an address on the list, as an admin does on the admin page (A25). */
export const allowEmail = async (email: string, role: Role = 'member') =>
  call('POST', '/admin/allowed-emails', await seedToken(), { email, role });

/** A new member (or admin) with this display name, who has signed in with Google once. */
export async function createPerson(displayName: string, role: Role = 'member'): Promise<Person> {
  const email = uniqueEmail(displayName);
  await googleAccount({ email, name: displayName });
  await allowEmail(email, role);
  const result = await signInWithGoogle(email);
  if (result.status !== 'signed_in') throw new Error(`${email} is not signed in`);
  return {
    id: result.user.id,
    username: result.user.username,
    displayName,
    email,
    token: result.tokens.accessToken,
  };
}

/** A room made by the seed admin; everyone sees it (A8). */
export const createRoom = async (name: string) =>
  call('POST', '/rooms', await seedToken(), { name }, Room);

export const sendMessage = (
  as: Person,
  roomId: string,
  body: string,
  attachmentIds: string[] = [],
) =>
  call(
    'POST',
    `/rooms/${roomId}/messages`,
    as.token,
    { id: newId(), body, attachmentIds },
    Message,
  );

export async function uploadFile(as: Person, name: string, mime: string, data: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type: mime }), name);
  return call('POST', '/files', as.token, form, Attachment);
}

// ---- the desktop app -------------------------------------------------------------------------

export interface Desktop {
  /**
   * Starts the app with fresh data: another `launch` is another computer. `google` is the Google
   * account the browser is signed in to, which "Sign in with Google" then uses.
   */
  launch(options?: { google?: string }): Promise<Page>;
  /** Starts the app and signs in as this person, through the sign-in screen. */
  signedIn(person: Person): Promise<Page>;
  /** Restarts the app on the same computer (same data folder) as `page`. */
  restart(page: Page): Promise<Page>;
  /** Quits the app showing `page` (that computer goes offline). */
  close(page: Page): Promise<void>;
  /** The Electron app behind a page, to reach its main process. */
  appOf(page: Page): ElectronApplication;
}

export const test = base.extend<{ desktop: Desktop }>({
  // Playwright reads a fixture's dependencies from this pattern; this one has none.
  // eslint-disable-next-line no-empty-pattern
  desktop: async ({}, use) => {
    const running = new Map<
      Page,
      { app: ElectronApplication; dataDir: string; google: string | undefined }
    >();
    const dirs: string[] = [];

    const start = async (dataDir: string, google: string | undefined) => {
      const app = await electron.launch({
        // Fake microphone (a beeping tone) and camera. Permissions go through the app's handler.
        args: ['--use-fake-device-for-media-stream', APP_DIR, '--lang=tr'],
        env: {
          ...process.env,
          HASBIHAL_SERVER_URL: serverUrl(),
          HASBIHAL_LIVEKIT_URL: process.env.E2E_LIVEKIT_URL ?? '',
          // Screen sharing shares the app's own page: no screen-recording permission needed.
          HASBIHAL_FAKE_SCREEN: '1',
          HASBIHAL_USER_DATA_DIR: dataDir,
          // Google is the stand-in, and its "browser" is signed in to this account.
          HASBIHAL_GOOGLE_URL: googleUrl(),
          HASBIHAL_GOOGLE_LOGIN_HINT: google ?? '',
        },
      });
      const page = await app.firstWindow();
      running.set(page, { app, dataDir, google });
      return page;
    };

    const desktop: Desktop = {
      async launch(options = {}) {
        const dir = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-'));
        dirs.push(dir);
        return start(dir, options.google);
      },
      async signedIn(person) {
        const page = await desktop.launch({ google: person.email });
        await page.getByRole('button', { name: 'Google ile giriş yap' }).click();
        await page.getByTestId('current-user').filter({ hasText: person.displayName }).waitFor();
        return page;
      },
      async restart(page) {
        const entry = running.get(page);
        if (!entry) throw new Error('not a running app');
        await desktop.close(page);
        return start(entry.dataDir, entry.google);
      },
      appOf(page) {
        const entry = running.get(page);
        if (!entry) throw new Error('not a running app');
        return entry.app;
      },
      async close(page) {
        const entry = running.get(page);
        running.delete(page);
        await entry?.app.close();
      },
    };

    await use(desktop);
    await Promise.all([...running.values()].map(({ app }) => app.close()));
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  },
});

export { expect } from '@playwright/test';

/**
 * With E2E_SCREENSHOTS=<dir>, saves what the user sees at key moments, for UI review. Use a
 * folder outside test-results/: Playwright empties that one at the start of every run.
 */
export async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOTS;
  // Transitions finished first: a shot right after a change would catch colors mid-fade.
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled' });
}

/** The member list row for a display name. */
export const memberRow = (page: Page, name: string) =>
  page.getByTestId('member').filter({ hasText: name });

/** A room in the sidebar, by name. */
export const roomButton = (page: Page, name: string) =>
  page.getByTestId('room').filter({ hasText: name });
