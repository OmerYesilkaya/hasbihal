import type { Locator } from '@playwright/test';
import { createPerson, createRoom, expect, roomButton, test } from './support.ts';

/** Every popup, modal or not, closes on a click outside it, like on Esc. */
test('popups and dialogs close on a click outside', async ({ desktop }) => {
  const room = await createRoom('Sofa');
  const page = await desktop.signedIn(await createPerson('Leyla Test'));
  await roomButton(page, room.name).click();
  /**
   * A click far from every popup and dialog (the middle of the window's bottom edge) closes
   * `popup`. Radix starts listening for outside clicks a tick after opening, sooner than a person
   * could click, so this clicks again until it closes.
   */
  const closesOnOutsideClick = async (popup: Locator) => {
    // The e2e code has no DOM types; the window's size, read in the page.
    const { width, height } = await page.evaluate(() => {
      const view = globalThis as unknown as { innerWidth: number; innerHeight: number };
      return { width: view.innerWidth, height: view.innerHeight };
    });
    await expect(async () => {
      await page.mouse.click(width / 2, height - 30);
      await expect(popup).toBeHidden({ timeout: 500 });
    }).toPass({ timeout: 5000 });
  };

  // A modal dialog.
  await page.getByTestId('current-user').click();
  await page.getByRole('menuitem', { name: 'Profili düzenle' }).click();
  const profile = page.getByRole('dialog', { name: 'Profil' });
  await expect(profile).toBeVisible();
  await closesOnOutsideClick(profile);

  // A popover: the room's notification settings.
  await page.getByTestId('room-prefs').click();
  const prefs = page.getByRole('dialog', { name: 'Bildirimler' });
  await expect(prefs).toBeVisible();
  await closesOnOutsideClick(prefs);

  // A menu: the room's "⋯" in the sidebar; choosing an item closes it too.
  const row = page.locator('.room-row', { has: roomButton(page, room.name) });
  await roomButton(page, room.name).hover();
  await row.getByTestId('room-menu').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await closesOnOutsideClick(menu);
  await roomButton(page, room.name).hover();
  await row.getByTestId('room-menu').click();
  await page.getByRole('menuitem', { name: 'Favorilere ekle' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Favoriler' })).toBeVisible();

  // Settings, from the gear.
  await page.getByTestId('open-settings').click();
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();
  await closesOnOutsideClick(settings);
});
