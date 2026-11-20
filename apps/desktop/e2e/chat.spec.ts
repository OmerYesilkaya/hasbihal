import { createPerson, expect, roomButton, snap, test } from './support.ts';

test('chats in a room: formatting, mentions, replies, reactions, edits, deletes', async ({
  desktop,
}) => {
  const mehmet = await createPerson('Mehmet Test', 'admin');
  const kerem = await createPerson('Kerem Test');
  const host = await desktop.signedIn(mehmet);
  host.on('dialog', (dialog) => void dialog.accept()); // "Bu mesaj silinsin mi?"
  const guest = await desktop.signedIn(kerem);

  // Mehmet (an admin) opens a room; Kerem sees it appear.
  await host.getByRole('button', { name: 'Oda ekle' }).click();
  await host.getByLabel('Oda adı').fill('Salon');
  await host.getByLabel('Oda adı').press('Enter');
  await expect(host.getByRole('heading', { name: 'Salon', level: 1 })).toBeVisible();
  await roomButton(guest, 'Salon').click();
  await expect(guest.getByRole('heading', { name: 'Salon', level: 1 })).toBeVisible();

  // Formatting shows while typing; @ker suggests Kerem by name.
  const composer = host.getByLabel('Mesaj', { exact: true });
  await composer.pressSequentially('**Merhaba** @ker');
  await expect(host.getByRole('option', { name: /Kerem Test/ })).toBeVisible();
  await composer.press('Enter');
  await composer.pressSequentially('akşam _çay_ var mı?');
  await expect(composer).toHaveValue(`**Merhaba** @${kerem.username} akşam _çay_ var mı?`);
  await snap(host, '7-composer-live-formatting');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');

  // Kerem sees it formatted, with his own name highlighted.
  const firstMatch = guest.getByTestId('message').filter({ hasText: 'Merhaba' });
  await expect(firstMatch).toHaveCount(1);
  // Pinned by id: later, Kerem's reply quotes "Merhaba" too.
  const messageId = await firstMatch.getAttribute('data-message-id');
  const fromHost = guest.locator(`[data-message-id="${messageId ?? ''}"]`);
  const hostsOwn = host.locator(`[data-message-id="${messageId ?? ''}"]`);
  await expect(fromHost.locator('strong')).toHaveText('Merhaba');
  await expect(fromHost.locator('em')).toHaveText('çay');
  await expect(fromHost.locator('.mention[data-me]')).toHaveText('@Kerem Test');

  // Kerem types: Mehmet sees it. Then Kerem replies.
  const guestComposer = guest.getByLabel('Mesaj', { exact: true });
  await guestComposer.pressSequentially('Var tabii');
  await expect(host.getByTestId('typing')).toHaveText('Kerem Test yazıyor…');
  await guestComposer.fill('');
  await fromHost.hover();
  await fromHost.getByRole('button', { name: 'Yanıtla' }).click();
  await expect(guest.getByText('Yanıtlanan: Mehmet Test')).toBeVisible();
  await guestComposer.pressSequentially('Var tabii, geliyorum');
  await guestComposer.press('Enter');
  const reply = host.getByTestId('message').filter({ hasText: 'geliyorum' });
  await expect(reply.locator('.message__reply')).toContainText('Mehmet Test');

  // Kerem reacts; Mehmet sees it live.
  await fromHost.hover();
  await fromHost.getByRole('button', { name: 'Tepki ver' }).click();
  await guest.getByRole('button', { name: '🌷', exact: true }).click();
  await expect(fromHost.getByRole('button', { name: /🌷 1/ })).toBeVisible();
  await expect(hostsOwn.getByRole('button', { name: /🌷 1/ })).toBeVisible();
  // Any emoji, found by its Turkish name.
  await fromHost.hover();
  await fromHost.getByRole('button', { name: 'Tepki ver' }).click();
  await guest.getByTestId('emoji-more').click();
  await guest.getByLabel('Emoji ara').fill('kaplumbağa');
  await expect(guest.getByRole('button', { name: 'kaplumbağa' })).toBeVisible();
  await guest.getByLabel('Emoji ara').press('Enter');
  await expect(fromHost.getByRole('button', { name: /🐢 1/ })).toBeVisible();

  // Mehmet edits his last message with ↑, then deletes it.
  await composer.press('ArrowUp');
  await expect(host.getByText('Mesajı düzenliyorsun')).toBeVisible();
  await composer.fill('**Merhaba** herkese');
  await composer.press('Enter');
  const edited = guest.getByTestId('message').filter({ hasText: 'herkese' });
  await expect(edited).toContainText('(düzenlendi)');
  await snap(guest, '8-room-conversation');
  const own = host.getByTestId('message').filter({ hasText: 'herkese' });
  await own.hover();
  await own.getByRole('button', { name: 'Sil' }).click();
  await expect(guest.getByText('Bu mesaj silindi.').first()).toBeVisible();

  // A message in another room shows up as an unread badge, marked as a mention.
  await host.getByRole('button', { name: 'Oda ekle' }).click();
  await host.getByLabel('Oda adı').fill('Mutfak');
  await host.getByLabel('Oda adı').press('Enter');
  await expect(host.getByRole('heading', { name: 'Mutfak', level: 1 })).toBeVisible();
  await composer.pressSequentially(`@${kerem.username} yemek hazır!`);
  await composer.press('Enter');
  const mutfak = roomButton(guest, 'Mutfak');
  await expect(mutfak.getByTestId('unread')).toHaveText('1');
  await expect(mutfak.getByTestId('unread')).toHaveAttribute('data-mention', 'true');
  await mutfak.click();
  await expect(roomButton(guest, 'Mutfak').getByTestId('unread')).toHaveCount(0);
});
