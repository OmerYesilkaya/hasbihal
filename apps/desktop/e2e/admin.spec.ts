import { createPerson, createRoom, expect, snap, test } from './support.ts';

test('runs the admin page: invite, admin rights, rooms (A44)', async ({ desktop }) => {
  await createRoom('Çatı katı');
  await createPerson('Burak Test', 'admin');
  const page = await desktop.signedIn(await createPerson('Murat Test', 'admin'));
  await page.getByRole('button', { name: /Yönetim/ }).click();
  const admin = page.getByTestId('admin');

  await admin.getByRole('button', { name: 'Davet bağlantısı oluştur' }).click();
  await expect(admin.getByTestId('one-time-link')).toContainText('hasbihal://invite/');
  await expect(admin.getByText('Kullanılmamış davetler')).toBeVisible();

  await admin.getByRole('tab', { name: 'Üyeler' }).click();
  const kerem = admin.getByTestId('admin-member').filter({ hasText: 'Burak Test' });
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
