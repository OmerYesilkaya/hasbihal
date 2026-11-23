import { createPerson, createRoom, expect, snap, test, uniqueEmail } from './support.ts';

test('runs the admin page: who may join, admin rights, rooms (A44)', async ({ desktop }) => {
  await createRoom('Çatı katı');
  await createPerson('Burak Test', 'admin');
  const page = await desktop.signedIn(await createPerson('Murat Test', 'admin'));
  await page.getByRole('button', { name: /Yönetim/ }).click();
  const admin = page.getByTestId('admin');

  // Let an address in (A25), then think better of it.
  const email = uniqueEmail('Yeni Gelen');
  await admin.getByLabel('Google adresi').fill('bu bir adres değil');
  await admin.getByRole('button', { name: 'Ekle' }).click();
  await expect(admin.getByText('Bu bir e-posta adresi gibi görünmüyor.')).toBeVisible();
  await admin.getByLabel('Google adresi').fill(email);
  await admin.getByRole('button', { name: 'Ekle' }).click();
  const allowed = admin.getByTestId('allowed-email').filter({ hasText: email });
  await expect(allowed).toBeVisible();
  await allowed.getByRole('button', { name: 'Kaldır' }).click();
  await expect(allowed).toHaveCount(0);

  await admin.getByRole('tab', { name: 'Üyeler' }).click();
  const kerem = admin.getByTestId('admin-member').filter({ hasText: 'Burak Test' });
  // Members show the Google address they sign in with.
  await expect(kerem).toContainText('@gmail.com');
  // Burak is an admin: take his rights away, then give them back.
  await kerem.getByRole('button', { name: 'Yöneticilikten çıkar' }).click();
  await expect(kerem.locator('.admin__badge')).toHaveCount(0);
  await kerem.getByRole('button', { name: 'Yönetici yap' }).click();
  await expect(kerem.locator('.admin__badge')).toHaveText('Yönetici');
  await snap(page, '18-admin');

  await admin.getByRole('tab', { name: 'Odalar' }).click();
  const mutfak = admin.getByTestId('admin-room').filter({ hasText: 'Çatı katı' });
  await mutfak.getByRole('button', { name: 'Arşivle' }).click();
  await expect(mutfak).toContainText('Arşivde');
  await expect(page.getByTestId('room').filter({ hasText: 'Çatı katı' })).toHaveCount(0);
  await mutfak.getByRole('button', { name: 'Arşivden çıkar' }).click();
  await expect(page.getByTestId('room').filter({ hasText: 'Çatı katı' })).toHaveCount(1);
});
