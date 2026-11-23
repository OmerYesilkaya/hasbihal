import {
  allowEmail,
  createPerson,
  expect,
  googleAccount,
  memberRow,
  snap,
  test,
  uniqueEmail,
} from './support.ts';

test('signs in with Google: name and photo come from Google; stays signed in after a restart', async ({
  desktop,
}) => {
  const email = uniqueEmail('Ömer Test');
  await googleAccount({
    email,
    name: 'Ömer Test',
    picture: `${process.env.E2E_SITE_URL ?? ''}/kapak.jpg`,
  });
  await allowEmail(email);

  const page = await desktop.launch({ google: email });
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
  await snap(page, '1-sign-in');
  await page.getByRole('button', { name: 'Google ile giriş yap' }).click();
  await expect(page.getByTestId('current-user')).toHaveText('Ömer Test');
  // The Google photo arrives a moment later, copied by the server (A40).
  await expect(page.locator('.user-panel img.avatar__photo')).toBeVisible();
  await snap(page, '2-signed-in');

  const again = await desktop.restart(page);
  await expect(again.getByTestId('current-user')).toHaveText('Ömer Test');
});

test('someone not on the list asks to join; an admin lets them in', async ({ desktop }) => {
  const admin = await desktop.signedIn(await createPerson('Yönetici Test', 'admin'));

  const email = uniqueEmail('Kemal Test');
  await googleAccount({ email, name: 'Kemal Test' });
  const kemal = await desktop.launch({ google: email });
  await kemal.getByRole('button', { name: 'Google ile giriş yap' }).click();
  await expect(kemal.getByRole('heading', { name: 'Henüz listede değilsin' })).toBeVisible();
  await expect(kemal.getByText(email)).toBeVisible();
  await kemal.getByRole('button', { name: 'Erişim iste' }).click();
  await expect(kemal.getByText(/İsteğin iletildi/)).toBeVisible();
  await snap(kemal, '3-access-requested');

  // The admin sees someone waiting, and lets them in.
  const adminButton = admin.getByRole('button', { name: /Yönetim/ });
  await expect(adminButton).toContainText('1');
  await adminButton.click();
  const request = admin.getByTestId('access-request').filter({ hasText: 'Kemal Test' });
  await expect(request).toContainText(email);
  await snap(admin, '4-admin-sees-request');
  await request.getByRole('button', { name: 'İzin ver' }).click();
  await expect(admin.getByTestId('allowed-email').filter({ hasText: email })).toBeVisible();

  await kemal.getByRole('button', { name: 'Yeniden giriş yap' }).click();
  await expect(kemal.getByTestId('current-user')).toHaveText('Kemal Test');
  await expect(memberRow(admin, 'Kemal Test')).toBeVisible();
});

test('signs out, and back in with one click', async ({ desktop }) => {
  const selin = await createPerson('Selin Test');
  const page = await desktop.signedIn(selin);
  await page.getByTestId('current-user').click();
  await page.getByRole('menuitem', { name: 'Çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();

  await page.getByRole('button', { name: 'Google ile giriş yap' }).click();
  await expect(page.getByTestId('current-user')).toHaveText('Selin Test');
});

test('shows another member joining and their status, live', async ({ desktop }) => {
  const page = await desktop.signedIn(await createPerson('Deniz Test'));
  await expect(memberRow(page, 'Deniz Test')).toContainText('Müsait');

  // A second computer: Ayşe, just let in, signs in for the first time there.
  const email = uniqueEmail('Ayşe Test');
  await googleAccount({ email, name: 'Ayşe Test' });
  await allowEmail(email);
  const other = await desktop.launch({ google: email });
  await other.getByRole('button', { name: 'Google ile giriş yap' }).click();
  await expect(other.getByTestId('current-user')).toHaveText('Ayşe Test');

  await expect(memberRow(page, 'Ayşe Test')).toContainText('Müsait');
  // Your status is under your name; a click on it changes it.
  await other.getByTestId('current-user').click();
  await other.getByRole('menuitemradio', { name: 'Meşgul' }).click();
  await other.keyboard.press('Escape');
  await expect(other.getByTestId('current-status')).toHaveText('Meşgul');
  await expect(memberRow(page, 'Ayşe Test')).toContainText('Meşgul');
  await snap(page, '6-members-live');

  await desktop.close(other);
  await expect(memberRow(page, 'Ayşe Test')).toContainText('Çevrimdışı');
});
