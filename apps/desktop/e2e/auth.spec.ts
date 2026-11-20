import {
  adminInviteUrl,
  createInvite,
  createPerson,
  expect,
  memberRow,
  PASSWORD,
  snap,
  test,
} from './support.ts';

test('signs up from a hasbihal:// invite link, and stays signed in after a restart', async ({
  desktop,
}) => {
  const inviteUrl = await adminInviteUrl();
  const page = await desktop.launch();
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
  await snap(page, '1-sign-in');

  await desktop.openLink(page, inviteUrl);
  await expect(page.getByRole('heading', { name: 'Hesap oluştur' })).toBeVisible();
  await expect(page.getByLabel('Davet bağlantısı veya kodu')).toHaveValue(
    inviteUrl.split('/').at(-1) ?? '',
  );
  await expect(page.getByText('Yönetici olarak davet edildin.')).toBeVisible();
  await snap(page, '2-sign-up-from-link');

  await page.getByLabel('Görünen ad').fill('Ömer Test');
  await page.getByLabel('Kullanıcı adı').fill('omer');
  await page.getByLabel('Parola').fill('kısa');
  await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await expect(page.getByText('Parola en az 10 karakter olmalı.')).toBeVisible();
  await snap(page, '3-sign-up-validation');

  await page.getByLabel('Parola').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await expect(page.getByTestId('current-user')).toHaveText('Ömer Test');
  await snap(page, '4-signed-in');

  const again = await desktop.restart(page);
  await expect(again.getByTestId('current-user')).toHaveText('Ömer Test');
});

test('signs out, refuses a wrong password, and signs back in', async ({ desktop }) => {
  const selin = await createPerson('Selin Test');
  const page = await desktop.signedIn(selin);
  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();

  await page.getByLabel('Kullanıcı adı').fill(selin.username);
  await page.getByLabel('Parola').fill('yanlış parola deneme');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.getByText('Kullanıcı adı veya parola yanlış.')).toBeVisible();
  await snap(page, '5-wrong-password');

  await page.getByLabel('Parola').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.getByTestId('current-user')).toHaveText('Selin Test');
});

test('shows another member joining and their status, live', async ({ desktop }) => {
  const page = await desktop.signedIn(await createPerson('Deniz Test'));
  await expect(memberRow(page, 'Deniz Test')).toContainText('Müsait');

  // A second computer: Ayşe signs up there from her invite link.
  const other = await desktop.launch();
  await desktop.openLink(other, (await createInvite()).url);
  await other.getByLabel('Görünen ad').fill('Ayşe Test');
  await other.getByLabel('Kullanıcı adı').fill('ayse');
  await other.getByLabel('Parola').fill('ikinci uzun parola cümlesi');
  await other.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await expect(other.getByTestId('current-user')).toHaveText('Ayşe Test');

  await expect(memberRow(page, 'Ayşe Test')).toContainText('Müsait');
  await other.getByRole('combobox', { name: 'Durum' }).click();
  await other.getByRole('option', { name: 'Meşgul' }).click();
  await expect(memberRow(page, 'Ayşe Test')).toContainText('Meşgul');
  await snap(page, '6-members-live');

  await desktop.close(other);
  await expect(memberRow(page, 'Ayşe Test')).toContainText('Çevrimdışı');
});

test('explains that a used invite no longer works', async ({ desktop }) => {
  const invite = await createInvite();
  const page = await desktop.launch();
  await desktop.openLink(page, invite.url);
  await page.getByLabel('Görünen ad').fill('Tuba Test');
  await page.getByLabel('Kullanıcı adı').fill('tuba');
  await page.getByLabel('Parola').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await expect(page.getByTestId('current-user')).toHaveText('Tuba Test');

  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await page.getByRole('button', { name: 'Davet bağlantın mı var? Hesap oluştur' }).click();
  await page.getByLabel('Davet bağlantısı veya kodu').fill(invite.url);
  await expect(page.getByText(/Bu davet geçersiz, kullanılmış ya da süresi dolmuş/)).toBeVisible();
});
