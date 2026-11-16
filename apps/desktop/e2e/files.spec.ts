import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPerson, createRoom, expect, roomButton, snap, test } from './support.ts';

test('shares a photo, a file, a voice message, and a link with a preview', async ({ desktop }) => {
  const room = await createRoom('Kiler');
  const page = await desktop.signedIn(await createPerson('Can Test'));
  await roomButton(page, room.name).click();
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
  await composer.fill('Bayram sofrasından');
  await composer.press('Enter');
  await expect(page.getByTestId('upload')).toHaveCount(0);

  const sent = page.getByTestId('message').filter({ hasText: 'Bayram sofrasından' });
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
});
