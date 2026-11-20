import { createPerson, createRoom, expect, roomButton, snap, test } from './support.ts';

test('plans a weekly event: create, RSVP, skip one (A15, A16)', async ({ desktop }) => {
  const room = await createRoom('Ders odası');
  await createPerson('Ece Test');
  const page = await desktop.signedIn(await createPerson('Emre Test', 'admin'));
  await roomButton(page, room.name).click();
  await page.getByTestId('event-chip').click();
  const dialog = page.getByTestId('events-dialog');
  await expect(dialog).toContainText('Önümüzdeki dört haftada etkinlik yok.');

  await dialog.getByRole('button', { name: 'Etkinlik ekle' }).click();
  await dialog.getByLabel('Başlık').fill('Ders');
  await dialog.getByLabel('Açıklama').fill('Matematik, 5. ünite');
  await dialog.getByRole('combobox', { name: 'Tekrar' }).click();
  await page.getByRole('option', { name: 'Her hafta' }).click();
  await dialog.getByLabel('Ece Test').check();
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
  await expect(occurrences.first().getByTestId('rsvp-coming')).toHaveText('Emre Test');

  const second = occurrences.nth(1);
  await second.getByRole('button', { name: 'Etkinliği yönet' }).click();
  await page.getByRole('menuitem', { name: 'Bu seferlik atla' }).click();
  await expect(second).toHaveAttribute('data-skipped', 'true');
  await expect(second).toContainText('yapılmayacak');
  await snap(page, '17-events');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('event-chip')).toContainText(/Ders · (Bugün|Yarın) \d\d:00/);
});
