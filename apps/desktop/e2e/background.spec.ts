import { createPerson, createRoom, expect, roomButton, snap, test } from './support.ts';

test('mutes a room, and keeps the setting (A28)', async ({ desktop }) => {
  const room = await createRoom('Avlu');
  const page = await desktop.signedIn(await createPerson('Sena Test'));
  await roomButton(page, room.name).click();

  const bell = page.getByTestId('room-prefs');
  await expect(bell).not.toHaveAttribute('data-muted');
  await bell.click();
  await page.getByLabel('Sessiz').check();
  await expect(bell).toHaveAttribute('data-muted', 'true');
  await expect(roomButton(page, room.name)).toHaveAttribute('data-muted', 'true');
  // Sound is only for "every message"; the hangout alert goes with muting.
  await expect(page.getByLabel('Her mesajda ses çal')).toBeDisabled();
  await expect(page.getByLabel('Sesli sohbet başlayınca haber ver')).toBeDisabled();
  await snap(page, '19-room-notifications');

  const again = await desktop.restart(page);
  await expect(roomButton(again, room.name)).toHaveAttribute('data-muted', 'true');
});

test('closing the window keeps the app running in the background (A38)', async ({ desktop }) => {
  const page = await desktop.signedIn(await createPerson('Oya Test'));
  const app = desktop.appOf(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
    .toBe(false);
  // Still connected: the window comes back as it was, still signed in.
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('activate');
  });
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
    .toBe(true);
  await expect(page.getByTestId('current-user')).toHaveText('Oya Test');
});
