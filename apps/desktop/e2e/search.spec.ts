import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createPerson,
  createRoom,
  expect,
  sendMessage,
  snap,
  test,
  uploadFile,
} from './support.ts';

test('searches every room, folding Turkish letters, and opens a result’s room (A27)', async ({
  desktop,
}) => {
  const elif = await createPerson('Elif Test');
  const balkon = await createRoom('Balkon');
  const teras = await createRoom('Teras');
  // The scene, set through the API: a message with two files, and one in another room.
  const photo = await uploadFile(
    elif,
    'manzara.jpg',
    'image/jpeg',
    await readFile(path.join(import.meta.dirname, 'fixtures/manzara.jpg')),
  );
  const note = await uploadFile(elif, 'liste.txt', 'text/plain', Buffer.from('peynir, zeytin'));
  await sendMessage(elif, balkon.id, 'Pazar kahvaltısı burada', [photo.id, note.id]);
  await sendMessage(elif, teras.id, 'Mangal yanıyor, gelin!');

  const page = await desktop.signedIn(elif);
  const search = page.getByRole('searchbox', { name: 'Mesajlarda ara' });
  await search.fill('KAHVALTI');
  const result = page.getByTestId('search-result');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('Pazar kahvaltısı burada');
  await expect(result.locator('mark')).toHaveText('kahvaltısı');
  await expect(result).toContainText('2 dosya');

  await search.fill('mangal yaniyor');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('# Teras');
  await snap(page, '16-search');
  await result.click();
  await expect(page.getByRole('heading', { name: 'Teras', level: 1 })).toBeVisible();
  await search.press('Escape');
  await expect(page.getByTestId('member').first()).toBeVisible();
});
