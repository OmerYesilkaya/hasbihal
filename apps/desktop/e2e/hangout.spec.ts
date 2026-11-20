import { createPerson, createRoom, expect, roomButton, snap, test } from './support.ts';

test('talks in a hangout: join, speaking, mute, camera, screen share, nudge, leave', async ({
  desktop,
}) => {
  const room = await createRoom('Bahçe');
  const omer = await desktop.signedIn(await createPerson('Ömer Faruk'));
  const zeynep = await desktop.signedIn(await createPerson('Zeynep Test'));
  await roomButton(omer, room.name).click();
  await roomButton(zeynep, room.name).click();

  // Ömer joins; Zeynep sees him in the sidebar and in the room's join bar.
  await omer.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
  await expect(omer.getByTestId('tile')).toHaveCount(1);
  await expect(zeynep.locator('.room__voice')).toContainText('Ömer Faruk');
  await expect(zeynep.getByText('1 kişi sohbette')).toBeVisible();

  // Zeynep joins: both see two tiles; the fake mic's tone makes Zeynep "speak" once noise
  // suppression, which rightly treats a beep as noise, is off.
  await zeynep.getByRole('button', { name: /Sesli sohbete katıl/ }).click();
  await expect(omer.getByTestId('tile')).toHaveCount(2);
  await expect(zeynep.getByTestId('tile')).toHaveCount(2);
  await zeynep.getByRole('button', { name: 'Ses ve görüntü ayarları' }).click();
  await zeynep.getByLabel('Gürültü engelleme').uncheck();
  await zeynep.getByRole('button', { name: 'Ses ve görüntü ayarları' }).click();
  await expect(omer.getByTestId('tile').filter({ hasText: 'Zeynep Test' })).toHaveAttribute(
    'data-speaking',
    'true',
    { timeout: 15_000 },
  );
  // Her own ring too, from her microphone's gate (#35).
  await expect(zeynep.getByTestId('tile').filter({ hasText: 'Sen' })).toHaveAttribute(
    'data-speaking',
    'true',
  );

  // Ömer mutes; Zeynep sees it.
  await omer.getByRole('button', { name: 'Mikrofonu kapat' }).click();
  await expect(
    zeynep.getByTestId('tile').filter({ hasText: 'Ömer Faruk' }).getByTestId('tile-muted'),
  ).toBeVisible();

  // Zeynep turns her camera on; Ömer gets video.
  await zeynep.getByRole('button', { name: 'Kamerayı aç' }).click();
  const zeynepTile = omer.getByTestId('tile').filter({ hasText: 'Zeynep Test' });
  await expect(zeynepTile.locator('video')).toBeVisible();
  // The ring still shows over her video (#35): it's drawn above it, not under.
  await expect(zeynepTile).toHaveAttribute('data-speaking', 'true');
  await expect
    .poll(() =>
      zeynepTile.evaluate(
        (el) =>
          (
            globalThis as unknown as {
              getComputedStyle(e: unknown, pseudo: string): { boxShadow: string };
            }
          ).getComputedStyle(el, '::after').boxShadow,
      ),
    )
    .toMatch(/rgb\((?!0, 0, 0)/);
  await snap(omer, '10-hangout');

  // Zeynep shares her screen. Ömer sees it live everywhere, and watches only when he chooses.
  await zeynep.getByRole('button', { name: 'Ekranını paylaş' }).click();
  await zeynep.getByTestId('share-source').click();
  await expect(zeynep.getByTestId('share-tile').locator('video')).toBeVisible();
  await expect(zeynep.getByTestId('share-tile')).toContainText('Senin ekranın');
  const share = omer.getByTestId('share-tile');
  await expect(share).toContainText('Zeynep Test · ekran');
  await expect(share.locator('video')).toHaveCount(0);
  await expect(omer.locator('.room__voice')).toContainText('CANLI');
  await expect(omer.getByTestId('member').filter({ hasText: 'Zeynep Test' })).toContainText(
    'CANLI',
  );
  await share.getByRole('button', { name: 'İzle' }).click();
  await expect(share.locator('video')).toBeVisible();
  // Real frames arrive, not just an element.
  await expect
    .poll(() =>
      share.locator('video').evaluate((v) => (v as unknown as { videoWidth: number }).videoWidth),
    )
    .toBeGreaterThan(0);
  await share.hover();
  await share.getByRole('button', { name: 'Büyüt' }).click();
  await expect(omer.locator('.stage--focused')).toBeVisible();
  await snap(omer, '11-screen-share');
  // Full screen (#34): the share fills the display.
  const fullscreen = () =>
    omer.evaluate(
      () =>
        (
          globalThis as unknown as {
            document: { fullscreenElement: { getAttribute(name: string): string | null } | null };
          }
        ).document.fullscreenElement?.getAttribute('data-testid') ?? null,
    );
  await share.hover();
  await share.getByRole('button', { name: 'Tam ekran' }).click();
  await expect.poll(fullscreen).toBe('share-tile');
  // Leaving is left to a person: under automation the window never finishes going full screen at
  // the system level, so Electron's exitFullscreen() waits forever. Stopping the share below
  // removes the tile, which ends full screen anyway.
  await zeynep.getByRole('button', { name: 'Paylaşımı durdur' }).click();
  await expect(share).toHaveCount(0);
  await expect(omer.locator('.room__voice')).not.toContainText('CANLI');

  // Zeynep leaves; Ömer calls her back in with a nudge.
  await zeynep.getByRole('button', { name: 'Ayrıl' }).click();
  await expect(omer.getByTestId('tile')).toHaveCount(1);
  const zeynepRow = omer.getByTestId('member').filter({ hasText: 'Zeynep Test' });
  await zeynepRow.hover();
  await zeynepRow.getByRole('button', { name: 'Sohbete çağır' }).click();
  await expect(omer.getByText('Çağrıldı · Zeynep Test')).toBeVisible();

  await omer.getByRole('button', { name: 'Ayrıl' }).click();
  await expect(zeynep.locator('.room__voice')).toHaveCount(0);
});
