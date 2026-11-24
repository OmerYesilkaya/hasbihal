import { createPerson, createRoom, expect, roomButton, snap, test } from './support.ts';

test('a Mahrem room: the list joins, others knock and are let in, outsiders leave (A55)', async ({
  desktop,
}) => {
  const room = await createRoom('Arapça');
  const sister = await desktop.signedIn(await createPerson('Zehra Abla'));
  const brother = await desktop.signedIn(await createPerson('Yusuf Kardeş'));
  const cousin = await desktop.signedIn(await createPerson('Kerem Kuzen'));
  for (const page of [sister, brother, cousin]) await roomButton(page, room.name).click();

  // Kerem is already in the call when Zehra makes the room Mahrem with only herself and Yusuf.
  await cousin.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
  await expect(cousin.getByTestId('tile')).toHaveCount(1);
  await sister.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
  await expect(sister.getByTestId('tile')).toHaveCount(2);

  const row = sister.locator('.room-row', { has: roomButton(sister, room.name) });
  await roomButton(sister, room.name).hover();
  await row.getByTestId('room-menu').click();
  await sister.getByRole('menuitem', { name: 'Mahremiyet…' }).click();
  const dialog = sister.getByTestId('mahrem-dialog');
  // Pre-filled with whoever is in the call; she takes Kerem off and puts Yusuf on.
  await expect(dialog.getByRole('checkbox', { name: 'Kerem Kuzen' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Kerem Kuzen' }).click();
  await expect(dialog).toContainText('sesli sohbetten çıkacaklar: Kerem Kuzen');
  await dialog.getByRole('checkbox', { name: 'Yusuf Kardeş' }).click();
  await snap(sister, '40-mahrem-dialog');
  await dialog.getByTestId('mahrem-save').click();
  await expect(dialog).toHaveCount(0);

  // Kerem is removed from the call and told why; everyone sees the lock; Yusuf is told.
  await expect(cousin.getByText(/listede olmadığın için sesli sohbetten çıkarıldın/)).toBeVisible();
  await expect(sister.getByTestId('tile')).toHaveCount(1);
  await expect(roomButton(cousin, room.name).getByTestId('room-mahrem-lock')).toBeVisible();
  await expect(brother.getByText('Mahrem yapıldı · Arapça · Zehra Abla')).toBeVisible();

  // Yusuf, on the list, joins directly. Kerem can only knock.
  await brother.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
  await expect(sister.getByTestId('tile')).toHaveCount(2);
  await expect(cousin.getByRole('button', { name: /Sesli sohbete katıl/ })).toHaveCount(0);
  await expect(cousin.getByTestId('mahrem-hint')).toBeVisible();
  await cousin.getByTestId('knock').click();
  await expect(cousin.getByTestId('knock')).toHaveText(/Kapı çalındı/);

  // Both on the list are asked; Zehra lets him in, and Yusuf's prompt closes.
  await expect(brother.getByText('Kerem Kuzen kapıyı çalıyor')).toBeVisible();
  const prompt = sister.locator('.toast', { hasText: 'Kerem Kuzen kapıyı çalıyor' });
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveCSS('opacity', '1'); // done sliding in
  await snap(sister, '41-mahrem-knock');
  await sister.getByRole('button', { name: 'İçeri al' }).click();
  await expect(brother.getByText('Kerem Kuzen kapıyı çalıyor')).toHaveCount(0);
  await expect(cousin.getByText('İçeri alındın · Zehra Abla')).toBeVisible();
  await expect(cousin.getByTestId('tile')).toHaveCount(3);
  await expect(sister.getByTestId('tile')).toHaveCount(3);

  // Once he leaves, he'd knock again. Zehra turns Mahrem off: the room is open to all.
  await cousin.getByRole('button', { name: 'Ayrıl' }).click();
  await expect(cousin.getByTestId('knock')).toBeVisible();
  await roomButton(sister, room.name).hover();
  await row.getByTestId('room-menu').click();
  await sister.getByRole('menuitem', { name: 'Mahremiyet…' }).click();
  await sister.getByTestId('mahrem-off').click();
  await sister.getByTestId('confirm').getByRole('button', { name: 'Mahremiyeti kaldır' }).click();
  await expect(cousin.getByRole('button', { name: /Sesli sohbete katıl/ })).toBeVisible();
  await expect(roomButton(cousin, room.name).getByTestId('room-mahrem-lock')).toHaveCount(0);
});
