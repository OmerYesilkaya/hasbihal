import { writeFile } from 'node:fs/promises';
import { createPerson, expect, memberRow, snap, test } from './support.ts';

test('edits the profile: photo, display name, devices', async ({ desktop }, testInfo) => {
  const page = await desktop.signedIn(await createPerson('Hatice Test'));
  await page.getByTestId('current-user').click();
  const dialog = page.getByRole('dialog', { name: 'Profil' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('session').filter({ hasText: 'Bu cihaz' })).toHaveCount(1);

  // A tiny PNG; the server turns it into a 256 px WebP.
  const photoPath = testInfo.outputPath('foto.png');
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

  await dialog.getByLabel('Görünen ad').fill('Hatice Yılmaz');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(dialog.getByText('Kaydedildi.')).toBeVisible();
  await snap(page, '9-profile');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('current-user')).toHaveText('Hatice Yılmaz');
  await expect(memberRow(page, 'Hatice Yılmaz').locator('img.avatar__photo')).toBeVisible();
});
