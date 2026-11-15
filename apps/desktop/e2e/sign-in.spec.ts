import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { SERVER_DIR } from './global-setup.ts';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const PASSWORD = 'çay ve simit her sabah';

let userData: string;
/** Every app started by a test; closed after it. */
const apps: ElectronApplication[] = [];

/** The first-admin command (A52), exactly as the owner runs it on the server. */
async function adminInviteUrl(): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['src/cli/create-admin-invite.ts'],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
    },
  );
  const url = /hasbihal:\/\/invite\/\S+/.exec(stdout)?.[0];
  if (!url) throw new Error(`no invite link in:\n${stdout}`);
  return url;
}

/** Starts the app; another `dataDir` is another computer (its own session and window). */
async function launch(dataDir = userData): Promise<Page> {
  const app = await electron.launch({
    args: [APP_DIR, '--lang=tr'],
    env: {
      ...process.env,
      HASBIHAL_SERVER_URL: process.env.E2E_SERVER_URL ?? '',
      HASBIHAL_USER_DATA_DIR: dataDir,
    },
  });
  apps.push(app);
  return app.firstWindow();
}

/** With E2E_SCREENSHOTS=<dir>, saves what the user sees at key moments, for UI review. */
async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Delivers a link the way macOS does when one is clicked in another app (the latest app). */
async function openLink(url: string): Promise<void> {
  await apps.at(-1)?.evaluate(({ app: electronApp }, link) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, link);
  }, url);
}

/** The member list row for a display name. */
const memberRow = (page: Page, name: string) =>
  page.getByTestId('member').filter({ hasText: name });

test.describe.serial('accounts in the desktop app', () => {
  let inviteUrl: string;

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-'));
    inviteUrl = await adminInviteUrl();
  });

  test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  test.afterAll(async () => {
    await rm(userData, { recursive: true, force: true });
  });

  test('signs up from a hasbihal:// invite link', async () => {
    const page = await launch();
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
    await snap(page, '1-sign-in');

    await openLink(inviteUrl);
    await expect(page.getByRole('heading', { name: 'Hesap oluştur' })).toBeVisible();
    await expect(page.getByLabel('Davet bağlantısı veya kodu')).toHaveValue(
      inviteUrl.split('/').at(-1) ?? '',
    );
    await expect(page.getByText('Yönetici olarak davet edildin.')).toBeVisible();
    await snap(page, '2-sign-up-from-link');

    await page.getByLabel('Görünen ad').fill('Ömer Test');
    await page.getByLabel('Kullanıcı adı').fill('omer');
    await page.getByLabel('Parola').fill('kısa');
    await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
    await expect(page.getByText('Parola en az 10 karakter olmalı.')).toBeVisible();
    await snap(page, '3-sign-up-validation');

    await page.getByLabel('Parola').fill(PASSWORD);
    await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
    await expect(page.getByTestId('current-user')).toHaveText('Ömer Test');
    await snap(page, '4-signed-in');
  });

  test('stays signed in after a restart', async () => {
    const page = await launch();
    await expect(page.getByTestId('current-user')).toHaveText('Ömer Test');
  });

  test('signs out, refuses a wrong password, and signs back in', async () => {
    const page = await launch();
    await page.getByRole('button', { name: 'Çıkış yap' }).click();
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();

    await page.getByLabel('Kullanıcı adı').fill('omer');
    await page.getByLabel('Parola').fill('yanlış parola deneme');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page.getByText('Kullanıcı adı veya parola yanlış.')).toBeVisible();
    await snap(page, '5-wrong-password');

    await page.getByLabel('Parola').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page.getByTestId('current-user')).toHaveText('Ömer Test');
  });

  test('shows another member joining and their status, live', async () => {
    const page = await launch();
    await expect(page.getByTestId('current-user')).toHaveText('Ömer Test');
    await expect(memberRow(page, 'Ömer Test')).toContainText('Müsait');

    // A second computer: its own data folder, so its own session.
    const otherData = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-other-'));
    try {
      const other = await launch(otherData);
      await openLink(await adminInviteUrl());
      await other.getByLabel('Görünen ad').fill('Ayşe Test');
      await other.getByLabel('Kullanıcı adı').fill('ayse');
      await other.getByLabel('Parola').fill('ikinci uzun parola cümlesi');
      await other.getByRole('button', { name: 'Hesabı oluştur' }).click();
      await expect(other.getByTestId('current-user')).toHaveText('Ayşe Test');

      await expect(memberRow(page, 'Ayşe Test')).toContainText('Müsait');
      await other.getByLabel('Durum').selectOption('busy');
      await expect(memberRow(page, 'Ayşe Test')).toContainText('Meşgul');
      await snap(page, '6-members-live');

      await apps.pop()?.close();
      await expect(memberRow(page, 'Ayşe Test')).toContainText('Çevrimdışı');
    } finally {
      await rm(otherData, { recursive: true, force: true });
    }
  });

  test('explains that a used invite no longer works', async () => {
    const page = await launch();
    await page.getByRole('button', { name: 'Çıkış yap' }).click();
    await page.getByRole('button', { name: 'Davet bağlantın mı var? Hesap oluştur' }).click();
    await page.getByLabel('Davet bağlantısı veya kodu').fill(inviteUrl);
    await expect(
      page.getByText(/Bu davet geçersiz, kullanılmış ya da süresi dolmuş/),
    ).toBeVisible();
  });
});
