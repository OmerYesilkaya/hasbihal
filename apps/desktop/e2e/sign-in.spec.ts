import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    // Fake microphone (a beeping tone) and camera. Permissions go through the app's own handler.
    args: ['--use-fake-device-for-media-stream', APP_DIR, '--lang=tr'],
    env: {
      ...process.env,
      HASBIHAL_SERVER_URL: process.env.E2E_SERVER_URL ?? '',
      HASBIHAL_LIVEKIT_URL: process.env.E2E_LIVEKIT_URL ?? '',
      // Screen sharing shares the app's own page: no screen-recording permission needed.
      HASBIHAL_FAKE_SCREEN: '1',
      HASBIHAL_USER_DATA_DIR: dataDir,
    },
  });
  apps.push(app);
  return app.firstWindow();
}

/**
 * With E2E_SCREENSHOTS=<dir>, saves what the user sees at key moments, for UI review. Use a
 * folder outside test-results/: Playwright empties that one at the start of every run.
 */
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

  test('chats in a room: formatting, mentions, replies, reactions, edits, deletes', async () => {
    const omer = await launch();
    await expect(omer.getByTestId('current-user')).toHaveText('Ömer Test');
    omer.on('dialog', (dialog) => void dialog.accept()); // "Bu mesaj silinsin mi?"

    // A second computer: Kerem signs up from an invite link.
    const otherData = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-kerem-'));
    try {
      const kerem = await launch(otherData);
      await openLink(await adminInviteUrl());
      await kerem.getByLabel('Görünen ad').fill('Kerem Test');
      await kerem.getByLabel('Kullanıcı adı').fill('kerem');
      await kerem.getByLabel('Parola').fill('üçüncü uzun parola cümlesi');
      await kerem.getByRole('button', { name: 'Hesabı oluştur' }).click();
      await expect(kerem.getByTestId('current-user')).toHaveText('Kerem Test');

      // Ömer (admin) opens the first room.
      await omer.getByRole('button', { name: 'Oda ekle' }).click();
      await omer.getByLabel('Oda adı').fill('Salon');
      await omer.getByLabel('Oda adı').press('Enter');
      await expect(omer.getByRole('heading', { name: 'Salon', level: 1 })).toBeVisible();
      await expect(kerem.getByRole('heading', { name: 'Salon', level: 1 })).toBeVisible();

      // Formatting shows while typing; @ker suggests Kerem by name.
      const composer = omer.getByLabel('Mesaj', { exact: true });
      await composer.pressSequentially('**Merhaba** @ker');
      await expect(omer.getByRole('option', { name: /Kerem Test/ })).toBeVisible();
      await composer.press('Enter');
      await composer.pressSequentially('akşam _çay_ var mı?');
      await expect(composer).toHaveValue('**Merhaba** @kerem akşam _çay_ var mı?');
      await snap(omer, '7-composer-live-formatting');
      await composer.press('Enter');
      await expect(composer).toHaveValue('');

      // Kerem sees it formatted, with his own name highlighted.
      const firstMatch = kerem.getByTestId('message').filter({ hasText: 'Merhaba' });
      await expect(firstMatch).toHaveCount(1);
      // Pinned by id: later, Kerem's reply quotes "Merhaba" too.
      const messageId = await firstMatch.getAttribute('data-message-id');
      const fromOmer = kerem.locator(`[data-message-id="${messageId ?? ''}"]`);
      const omersOwn = omer.locator(`[data-message-id="${messageId ?? ''}"]`);
      await expect(fromOmer.locator('strong')).toHaveText('Merhaba');
      await expect(fromOmer.locator('em')).toHaveText('çay');
      await expect(fromOmer.locator('.mention[data-me]')).toHaveText('@Kerem Test');

      // Kerem types: Ömer sees it. Then Kerem replies.
      const keremComposer = kerem.getByLabel('Mesaj', { exact: true });
      await keremComposer.pressSequentially('Var tabii');
      await expect(omer.getByTestId('typing')).toHaveText('Kerem Test yazıyor…');
      await keremComposer.fill('');
      await fromOmer.hover();
      await fromOmer.getByRole('button', { name: 'Yanıtla' }).click();
      await expect(kerem.getByText('Yanıtlanan: Ömer Test')).toBeVisible();
      await keremComposer.pressSequentially('Var tabii, geliyorum');
      await keremComposer.press('Enter');
      const reply = omer.getByTestId('message').filter({ hasText: 'geliyorum' });
      await expect(reply.locator('.message__reply')).toContainText('Ömer Test');

      // Kerem reacts; Ömer sees it live.
      await fromOmer.hover();
      await fromOmer.getByRole('button', { name: 'Tepki ver' }).click();
      await kerem.getByRole('menuitem', { name: '🌷' }).click();
      await expect(fromOmer.getByRole('button', { name: /🌷 1/ })).toBeVisible();
      await expect(omersOwn.getByRole('button', { name: /🌷 1/ })).toBeVisible();

      // Ömer edits his last message with ↑, then deletes it.
      await composer.press('ArrowUp');
      await expect(omer.getByText('Mesajı düzenliyorsun')).toBeVisible();
      await composer.fill('**Merhaba** herkese');
      await composer.press('Enter');
      const edited = kerem.getByTestId('message').filter({ hasText: 'herkese' });
      await expect(edited).toContainText('(düzenlendi)');
      await snap(kerem, '8-room-conversation');
      await omer.getByTestId('message').filter({ hasText: 'herkese' }).hover();
      await omer
        .getByTestId('message')
        .filter({ hasText: 'herkese' })
        .getByRole('button', { name: 'Sil' })
        .click();
      await expect(kerem.getByText('Bu mesaj silindi.').first()).toBeVisible();

      // A message in another room shows up as an unread badge.
      await omer.getByRole('button', { name: 'Oda ekle' }).click();
      await omer.getByLabel('Oda adı').fill('Mutfak');
      await omer.getByLabel('Oda adı').press('Enter');
      await expect(omer.getByRole('heading', { name: 'Mutfak', level: 1 })).toBeVisible();
      await composer.pressSequentially('@kerem yemek hazır!');
      await composer.press('Enter');
      const mutfak = kerem.getByTestId('room').filter({ hasText: 'Mutfak' });
      await expect(mutfak.getByTestId('unread')).toHaveText('1');
      await expect(mutfak.getByTestId('unread')).toHaveAttribute('data-mention', 'true');
      await mutfak.click();
      await expect(
        kerem.getByTestId('room').filter({ hasText: 'Mutfak' }).getByTestId('unread'),
      ).toHaveCount(0);

      await apps.pop()?.close();
    } finally {
      await rm(otherData, { recursive: true, force: true });
    }
  });

  test('edits the profile: photo, display name, devices', async () => {
    const page = await launch();
    await page.getByTestId('current-user').click();
    const dialog = page.getByRole('dialog', { name: 'Profil' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('session').filter({ hasText: 'Bu cihaz' })).toHaveCount(1);

    // A tiny PNG; the server turns it into a 256 px WebP.
    const photoPath = path.join(userData, 'foto.png');
    await writeFile(
      photoPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    await dialog.getByTestId('avatar-input').setInputFiles(photoPath);
    await expect(dialog.getByRole('button', { name: 'Fotoğrafı kaldır' })).toBeVisible();
    await expect(page.locator('.user-panel img.avatar__photo')).toBeVisible();

    await dialog.getByLabel('Görünen ad').fill('Ömer Faruk');
    await dialog.getByRole('button', { name: 'Kaydet' }).click();
    await expect(dialog.getByText('Kaydedildi.')).toBeVisible();
    await snap(page, '9-profile');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('current-user')).toHaveText('Ömer Faruk');
    await expect(
      page.getByTestId('member').filter({ hasText: 'Ömer Faruk' }).locator('img.avatar__photo'),
    ).toBeVisible();
  });

  test('talks in a hangout: join, speaking, mute, camera, nudge, leave', async () => {
    const omer = await launch();
    await expect(omer.getByTestId('current-user')).toHaveText('Ömer Faruk');
    await omer.getByTestId('room').filter({ hasText: 'Salon' }).click();

    const otherData = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-zeynep-'));
    try {
      const zeynep = await launch(otherData);
      await openLink(await adminInviteUrl());
      await zeynep.getByLabel('Görünen ad').fill('Zeynep Test');
      await zeynep.getByLabel('Kullanıcı adı').fill('zeynep');
      await zeynep.getByLabel('Parola').fill('dördüncü uzun parola cümlesi');
      await zeynep.getByRole('button', { name: 'Hesabı oluştur' }).click();
      await expect(zeynep.getByTestId('current-user')).toHaveText('Zeynep Test');
      await zeynep.getByTestId('room').filter({ hasText: 'Salon' }).click();

      // Ömer joins; Zeynep sees him in the sidebar and in the room's join bar.
      await omer.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
      await expect(omer.getByTestId('tile')).toHaveCount(1);
      await expect(zeynep.locator('.room__voice')).toContainText('Ömer Faruk');
      await expect(zeynep.getByText('1 kişi sohbette')).toBeVisible();

      // Zeynep joins: both see two tiles; the fake mic's tone makes Zeynep "speak" once noise
      // suppression, which rightly treats a beep as noise, is off.
      await zeynep.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
      await expect(omer.getByTestId('tile')).toHaveCount(2);
      await expect(zeynep.getByTestId('tile')).toHaveCount(2);
      await zeynep.getByRole('button', { name: 'Ses ve görüntü ayarları' }).click();
      await zeynep.getByLabel('Gürültü engelleme').uncheck();
      await zeynep.getByRole('button', { name: 'Ses ve görüntü ayarları' }).click();
      await expect(omer.getByTestId('tile').filter({ hasText: 'Zeynep Test' })).toHaveAttribute(
        'data-speaking',
        'true',
        { timeout: 15_000 },
      );

      // Ömer mutes; Zeynep sees it.
      await omer.getByRole('button', { name: 'Mikrofonu kapat' }).click();
      await expect(zeynep.getByTestId('tile').filter({ hasText: 'Ömer Faruk' })).toContainText(
        '🔇',
      );

      // Zeynep turns her camera on; Ömer gets video.
      await zeynep.getByRole('button', { name: 'Kamerayı aç' }).click();
      await expect(
        omer.getByTestId('tile').filter({ hasText: 'Zeynep Test' }).locator('video'),
      ).toBeVisible();
      await snap(omer, '10-hangout');

      // Zeynep shares her screen. Ömer sees it live everywhere, and watches only when he chooses.
      await zeynep.getByRole('button', { name: 'Ekranını paylaş' }).click();
      await zeynep.getByTestId('share-source').click();
      await expect(zeynep.getByTestId('share-tile').locator('video')).toBeVisible();
      await expect(zeynep.getByTestId('share-tile')).toContainText('Senin ekranın');
      const share = omer.getByTestId('share-tile');
      await expect(share).toContainText('Zeynep Test · ekran');
      await expect(share.locator('video')).toHaveCount(0);
      await expect(omer.locator('.room__voice')).toContainText('CANLI');
      await expect(omer.getByTestId('member').filter({ hasText: 'Zeynep Test' })).toContainText(
        'CANLI',
      );
      await share.getByRole('button', { name: 'İzle' }).click();
      await expect(share.locator('video')).toBeVisible();
      // Real frames arrive, not just an element.
      await expect
        .poll(() =>
          share
            .locator('video')
            .evaluate((v) => (v as unknown as { videoWidth: number }).videoWidth),
        )
        .toBeGreaterThan(0);
      await share.hover();
      await share.getByRole('button', { name: 'Büyüt' }).click();
      await expect(omer.locator('.stage--focused')).toBeVisible();
      await snap(omer, '11-screen-share');
      await zeynep.getByRole('button', { name: 'Paylaşımı durdur' }).click();
      await expect(share).toHaveCount(0);
      await expect(omer.locator('.room__voice')).not.toContainText('CANLI');

      // Zeynep leaves; Ömer calls her back in with a nudge.
      await zeynep.getByRole('button', { name: 'Ayrıl' }).click();
      await expect(omer.getByTestId('tile')).toHaveCount(1);
      const zeynepRow = omer.getByTestId('member').filter({ hasText: 'Zeynep Test' });
      await zeynepRow.hover();
      await zeynepRow.getByRole('button', { name: 'Sohbete çağır' }).click();
      await expect(zeynepRow).toContainText('Çağrıldı');

      await omer.getByRole('button', { name: 'Ayrıl' }).click();
      await expect(zeynep.locator('.room__voice')).toHaveCount(0);
      await apps.pop()?.close();
    } finally {
      await rm(otherData, { recursive: true, force: true });
    }
  });

  test('shares a photo and a file: upload, send, view, download card', async () => {
    const page = await launch();
    await page.getByTestId('room').filter({ hasText: 'Salon' }).click();
    await page.getByTestId('file-picker').setInputFiles([
      {
        name: 'manzara.jpg',
        mimeType: 'image/jpeg',
        buffer: await readFile(path.join(import.meta.dirname, 'fixtures/manzara.jpg')),
      },
      {
        name: 'Mercimek çorbası tarifi.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Mercimek, soğan, havuç, bir tutam kimyon.'),
      },
    ]);
    await expect(page.locator('[data-testid="upload"][data-status="done"]')).toHaveCount(2);
    const composer = page.getByLabel('Mesaj', { exact: true });
    await composer.fill('Pazar kahvaltısından');
    await composer.press('Enter');
    await expect(page.getByTestId('upload')).toHaveCount(0);

    const sent = page.getByTestId('message').filter({ hasText: 'Pazar kahvaltısından' });
    const photo = sent.getByTestId('attachment-media');
    // The thumbnail really loads, through a signed address the CSP allows.
    await expect
      .poll(() =>
        photo
          .locator('img')
          .evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(sent.getByTestId('attachment-file')).toContainText('Mercimek çorbası tarifi.txt');
    await expect(
      sent.getByTestId('attachment-file').getByRole('link', { name: 'İndir' }),
    ).toBeVisible();
    await snap(page, '12-attachments');

    await photo.click();
    const viewer = page.getByTestId('viewer');
    await expect(viewer).toBeVisible();
    await expect
      .poll(() =>
        viewer
          .locator('img')
          .evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBe(900); // the original, full size
    await snap(page, '13-viewer');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    // A voice message (A22): record a couple of seconds of the fake mic, send, play it back.
    await page.getByRole('button', { name: 'Sesli mesaj kaydet' }).click();
    await expect(page.getByTestId('recorder-time')).toHaveText('0:02', { timeout: 5_000 });
    await page.getByTestId('recorder').getByRole('button', { name: 'Gönder' }).click();
    const voice = page.getByTestId('voice-message').last();
    await expect(voice).toContainText('0:02');
    await voice.getByRole('button', { name: 'Dinle' }).click();
    await expect(voice).toHaveAttribute('data-playing', 'true');
    await snap(page, '14-voice-message');

    // A link gets a preview card (A24), fetched by the server and delivered live.
    const link = `${process.env.E2E_SITE_URL ?? ''}/tarif`;
    await composer.fill(`Bu akşam bunu yapalım mı? ${link}`);
    await composer.press('Enter');
    const preview = page
      .getByTestId('message')
      .filter({ hasText: 'Bu akşam' })
      .getByTestId('link-preview');
    await expect(preview).toContainText('Kuru fasulye ve pilav');
    await expect(preview).toContainText('Lezzet Defteri');
    await expect
      .poll(() =>
        preview
          .locator('img')
          .evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBeGreaterThan(0);
    // It arrives after the message; the conversation still ends with it in view.
    await expect(preview).toBeInViewport({ ratio: 1 });
    await snap(page, '15-link-preview');

    // Search (A27): Turkish letters fold both ways, across rooms; a result opens its room.
    const search = page.getByRole('searchbox', { name: 'Mesajlarda ara' });
    await search.fill('KAHVALTI');
    const result = page.getByTestId('search-result');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('Pazar kahvaltısından');
    await expect(result.locator('mark')).toHaveText('kahvaltısından');
    await expect(result).toContainText('2 dosya');
    await search.fill('yemek hazir');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('# Mutfak');
    await snap(page, '16-search');
    await result.click();
    await expect(page.getByRole('heading', { name: 'Mutfak', level: 1 })).toBeVisible();
    await search.press('Escape');
    await expect(page.getByTestId('member').first()).toBeVisible();
  });

  test('plans a weekly event: create, RSVP, skip one (A15, A16)', async () => {
    const page = await launch();
    await page.getByTestId('room').filter({ hasText: 'Salon' }).click();
    await page.getByTestId('event-chip').click();
    const dialog = page.getByTestId('events-dialog');
    await expect(dialog).toContainText('Önümüzdeki dört haftada etkinlik yok.');

    await dialog.getByRole('button', { name: 'Etkinlik ekle' }).click();
    await dialog.getByLabel('Başlık').fill('Ders');
    await dialog.getByLabel('Açıklama').fill('Matematik, 5. ünite');
    await dialog.getByLabel('Tekrar').selectOption({ label: 'Her hafta' });
    await dialog.getByLabel('Ayşe Test').check();
    await dialog.getByRole('button', { name: 'Kaydet' }).click();

    // Four weeks ahead: four or five Mondays-or-whatever-day, the first one coming up.
    const occurrences = dialog.getByTestId('occurrence');
    await expect(occurrences.first()).toContainText('Ders');
    expect(await occurrences.count()).toBeGreaterThanOrEqual(4);

    await occurrences.first().getByRole('button', { name: 'Geliyorum' }).click();
    await expect(occurrences.first().getByRole('button', { name: 'Geliyorum' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(occurrences.first()).toContainText('✓ Ömer Faruk');

    const second = occurrences.nth(1);
    await second.getByLabel('Etkinliği yönet').click();
    await second.getByRole('button', { name: 'Bu seferlik atla' }).click();
    await expect(second).toHaveAttribute('data-skipped', 'true');
    await expect(second).toContainText('yapılmayacak');
    await snap(page, '17-events');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('event-chip')).toContainText(/Ders · (Bugün|Yarın) \d\d:00/);
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
