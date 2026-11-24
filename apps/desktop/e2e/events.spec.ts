import { createPerson, createRoom, expect, roomButton, snap, test } from './support.ts';

test('plans a weekly event: create, RSVP, skip one (A15, A16)', async ({ desktop }) => {
  const room = await createRoom('Ders odası');
  await createPerson('Ece Test');
  const page = await desktop.signedIn(await createPerson('Emre Test', 'admin'));
  await roomButton(page, room.name).click();
  await page.getByTestId('event-chip').click();
  const dialog = page.getByTestId('events-dialog');
  await expect(dialog).toContainText('Önümüzdeki dört haftada etkinlik yok.');

  await dialog.getByRole('button', { name: 'Yeni etkinlik' }).click();
  await dialog.getByLabel('Başlık').fill('Ders');
  await dialog.getByLabel('Açıklama').fill('Matematik, 5. ünite');
  await dialog.getByRole('button', { name: 'Her hafta' }).click();
  await dialog.getByRole('button', { name: 'Ece Test' }).click();
  await snap(page, '16-event-form');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();

  // One card per event, at its next date, saying how it repeats (#40); its other dates in the
  // four weeks are pills on the card.
  const cards = dialog.getByTestId('event-card');
  await expect(cards).toHaveCount(1);
  const card = cards.first();
  await expect(card).toContainText('Ders');
  await expect(card.getByTestId('event-repeat')).toContainText('Her hafta');
  const dates = card.getByTestId('event-date');
  expect(await dates.count()).toBeGreaterThanOrEqual(4);
  await expect(dates.first()).toHaveAttribute('aria-pressed', 'true');

  await card.getByRole('button', { name: 'Geliyorum' }).click();
  await expect(card.getByRole('button', { name: 'Geliyorum' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card.getByTestId('rsvp-coming')).toHaveText('Emre Test geliyor');

  // The second date: the card switches to it, and it can be skipped on its own.
  await dates.nth(1).click();
  await expect(card.getByRole('button', { name: 'Geliyorum' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await card.getByRole('button', { name: 'Etkinliği yönet' }).click();
  await page.getByRole('menuitem', { name: 'Bu seferlik atla' }).click();
  await expect(card).toHaveAttribute('data-skipped', 'true');
  await expect(card).toContainText('Bu tarih atlandı');
  await expect(dates.nth(1)).toHaveAttribute('data-skipped', 'true');
  await snap(page, '17-events');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('event-chip')).toContainText(/(Bugün|Yarın) \d\d:00\s*Ders/);
});
