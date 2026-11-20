import { createPerson, createRoom, expect, roomButton, test } from './support.ts';

/** Every popup, modal or not, closes on a click outside it, like on Esc. */
test('popups and dialogs close on a click outside', async ({ desktop }) => {
  const room = await createRoom('Sofa');
  const page = await desktop.signedIn(await createPerson('Leyla Test'));
  await roomButton(page, room.name).click();
  // Far from every popup: low in the chat column.
  const outside = async () => {
    const box = await page.locator('.content').boundingBox();
    if (!box) throw new Error('no content column');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 120);
  };

  // A modal dialog.
  await page.getByTestId('current-user').click();
  const profile = page.getByRole('dialog', { name: 'Profil' });
  await expect(profile).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(profile).toBeHidden();

  // A popover: the room's notification settings.
  await page.getByTestId('room-prefs').click();
  const prefs = page.getByRole('dialog', { name: 'Bildirimler' });
  await expect(prefs).toBeVisible();
  await outside();
  await expect(prefs).toBeHidden();

  // A menu: the room's "⋯" in the sidebar; choosing an item closes it too.
  const row = page.locator('.room-row', { has: roomButton(page, room.name) });
  await roomButton(page, room.name).hover();
  await row.getByTestId('room-menu').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await outside();
  await expect(menu).toBeHidden();
  await roomButton(page, room.name).hover();
  await row.getByTestId('room-menu').click();
  await page.getByRole('menuitem', { name: 'Favorilere ekle' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Favoriler' })).toBeVisible();

  // Settings, from the gear.
  await page.getByTestId('open-settings').click();
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(settings).toBeHidden();
});
