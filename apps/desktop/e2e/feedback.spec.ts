import { createPerson, expect, githubIssues, snap, test } from './support.ts';

test('sends feedback, which becomes a public issue without the sender’s name (A56)', async ({
  desktop,
}) => {
  const ayse = await createPerson('Ayşe Test');
  const page = await desktop.signedIn(ayse);

  await page.getByTestId('current-user').click();
  await page.getByRole('menuitem', { name: 'Geri bildirim gönder' }).click();
  const dialog = page.getByTestId('feedback');
  await expect(dialog.getByRole('heading', { name: 'Geri bildirim' })).toBeVisible();

  // An idea this time; it can't be sent until there is enough to read.
  await dialog.getByRole('button', { name: 'Öneri' }).click();
  const send = dialog.getByRole('button', { name: 'Gönder' });
  await dialog.getByLabel('Başlık').fill('Karanlık tema');
  await expect(send).toBeDisabled();
  await dialog
    .getByLabel('Ayrıntılar')
    .fill('Akşamları göz yormayan koyu bir tema olsa, @octocat.');
  // The versions go along unless unticked.
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await expect(send).toBeEnabled();
  await snap(page, '20-feedback');
  await send.click();
  await expect(page.getByText('Teşekkürler! Geri bildirimin iletildi.')).toBeVisible();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await githubIssues()).at(-1)?.title).toBe('Karanlık tema');
  const issue = (await githubIssues()).at(-1);
  expect(issue?.labels).toEqual(['feedback', 'enhancement']);
  expect(issue?.body).toContain('Akşamları göz yormayan koyu bir tema olsa');
  expect(issue?.body).toMatch(/\| App \| \d+\.\d+\.\d+ \|/);
  expect(issue?.body).not.toMatch(/@\w/); // nobody on GitHub is notified
  for (const who of ['Ayşe', ayse.username]) expect(issue?.body).not.toContain(who);
});
