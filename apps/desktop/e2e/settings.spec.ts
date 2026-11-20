import { createPerson, expect, test } from './support.ts';

test('settings: language, microphone test, camera preview', async ({ desktop }) => {
  const page = await desktop.signedIn(await createPerson('Derya Test'));
  await page.getByTestId('open-settings').click();
  const settings = page.getByTestId('settings');

  // The language changes at once, everywhere, and back.
  await settings.getByRole('combobox', { name: 'Dil' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('current-status')).toHaveText('Available');
  await settings.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();

  // Outside a call, the microphone plays back and the camera shows (fake devices here).
  await settings.getByRole('tab', { name: 'Ses ve görüntü' }).click();
  await settings.getByTestId('mic-test').click();
  await expect(settings.getByTestId('mic-test')).toHaveText('Denemeyi bitir');
  await settings.getByTestId('mic-test').click();
  await expect(settings.getByTestId('mic-test')).toHaveText('Mikrofonu dene');
  await settings.getByTestId('camera-preview').click();
  await expect(settings.locator('video')).toBeVisible();
  await expect
    .poll(() => settings.locator('video').evaluate((v) => (v as { videoWidth: number }).videoWidth))
    .toBeGreaterThan(0);
});
