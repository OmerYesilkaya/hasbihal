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
let app: ElectronApplication | undefined;

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

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [APP_DIR, '--lang=tr'],
    env: {
      ...process.env,
      HASBIHAL_SERVER_URL: process.env.E2E_SERVER_URL ?? '',
      HASBIHAL_USER_DATA_DIR: userData,
    },
  });
  return app.firstWindow();
}

/** With E2E_SCREENSHOTS=<dir>, saves what the user sees at key moments, for UI review. */
async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Delivers a link the way macOS does when one is clicked in another app. */
async function openLink(url: string): Promise<void> {
  await app?.evaluate(({ app: electronApp }, link) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, link);
  }, url);
}

test.describe.serial('accounts in the desktop app', () => {
  let inviteUrl: string;

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-'));
    inviteUrl = await adminInviteUrl();
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
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
