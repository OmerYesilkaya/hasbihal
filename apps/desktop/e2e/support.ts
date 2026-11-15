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
import { Attachment, Message, OneTimeLink, Room, SignedIn, type Role } from '@hasbihal/protocol';

// Shared by every spec: each test makes its own people and rooms through the API (milliseconds),
// so any one of them runs on its own (`pnpm test:e2e -g hangout`), in any order.

export const SERVER_DIR = path.resolve(import.meta.dirname, '../../server');
const APP_DIR = path.resolve(import.meta.dirname, '..');
export const PASSWORD = 'çay ve simit her sabah';

const serverUrl = () => process.env.E2E_SERVER_URL ?? '';

/** The first-admin command (A52), exactly as the owner runs it on the server. */
export async function adminInviteUrl(databaseUrl = process.env.E2E_DATABASE_URL): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['src/cli/create-admin-invite.ts'],
    { cwd: SERVER_DIR, env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  const url = /hasbihal:\/\/invite\/\S+/.exec(stdout)?.[0];
  if (!url) throw new Error(`no invite link in:\n${stdout}`);
  return url;
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

/** A person in a test: what the API returned, and how to sign in as them. */
export interface Person {
  id: string;
  username: string;
  displayName: string;
  password: string;
  token: string;
}

let seed: Promise<string> | undefined;
/** The seed admin's access token (made in global setup), for creating invites and rooms. */
function seedToken(): Promise<string> {
  seed ??= call(
    'POST',
    '/auth/sign-in',
    null,
    {
      username: process.env.E2E_SEED_USERNAME,
      password: PASSWORD,
      deviceName: 'e2e',
    },
    SignedIn,
  ).then((s) => s.tokens.accessToken);
  return seed;
}

let counter = 0;

/** A single-use invite link made by the seed admin. */
export const createInvite = async (role: Role = 'member') =>
  call('POST', '/invites', await seedToken(), { role }, OneTimeLink);

/**
 * A new member (or admin) with this display name. Usernames get a unique suffix: tests share the
 * database, so names must not collide between them.
 */
export async function createPerson(displayName: string, role: Role = 'member'): Promise<Person> {
  const invite = await createInvite(role);
  const username = `${displayName
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[^a-z]/g, '')
    .slice(0, 10)}${String(process.pid % 1000)}${String(++counter)}`;
  const signedIn = await call(
    'POST',
    '/auth/sign-up',
    null,
    { inviteToken: invite.token, username, displayName, password: PASSWORD, deviceName: 'e2e' },
    SignedIn,
  );
  return {
    id: signedIn.user.id,
    username,
    displayName,
    password: PASSWORD,
    token: signedIn.tokens.accessToken,
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
  /** Starts the app with fresh data: another `launch` is another computer. */
  launch(): Promise<Page>;
  /** Starts the app and signs in as this person, through the sign-in screen. */
  signedIn(person: Person): Promise<Page>;
  /** Restarts the app on the same computer (same data folder) as `page`. */
  restart(page: Page): Promise<Page>;
  /** Delivers a link to an app, the way macOS does when one is clicked elsewhere. */
  openLink(page: Page, url: string): Promise<void>;
  /** Quits the app showing `page` (that computer goes offline). */
  close(page: Page): Promise<void>;
}

export const test = base.extend<{ desktop: Desktop }>({
  // Playwright reads a fixture's dependencies from this pattern; this one has none.
  // eslint-disable-next-line no-empty-pattern
  desktop: async ({}, use) => {
    const running = new Map<Page, { app: ElectronApplication; dataDir: string }>();
    const dirs: string[] = [];

    const start = async (dataDir: string) => {
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
        },
      });
      const page = await app.firstWindow();
      running.set(page, { app, dataDir });
      return page;
    };

    const desktop: Desktop = {
      async launch() {
        const dir = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-'));
        dirs.push(dir);
        return start(dir);
      },
      async signedIn(person) {
        const page = await desktop.launch();
        await page.getByLabel('Kullanıcı adı').fill(person.username);
        await page.getByLabel('Parola').fill(person.password);
        await page.getByRole('button', { name: 'Giriş yap' }).click();
        await page.getByTestId('current-user').filter({ hasText: person.displayName }).waitFor();
        return page;
      },
      async restart(page) {
        const entry = running.get(page);
        if (!entry) throw new Error('not a running app');
        await desktop.close(page);
        return start(entry.dataDir);
      },
      async openLink(page, url) {
        await running.get(page)?.app.evaluate(({ app: electronApp }, link) => {
          electronApp.emit('open-url', { preventDefault: () => undefined }, link);
        }, url);
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
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The member list row for a display name. */
export const memberRow = (page: Page, name: string) =>
  page.getByTestId('member').filter({ hasText: name });

/** A room in the sidebar, by name. */
export const roomButton = (page: Page, name: string) =>
  page.getByTestId('room').filter({ hasText: name });
