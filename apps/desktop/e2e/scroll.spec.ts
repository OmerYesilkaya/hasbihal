import type { Page } from '@playwright/test';
import { createPerson, createRoom, expect, roomButton, sendMessage, test } from './support.ts';

interface Frame {
  top: number;
  height: number;
}

/** What the recording needs of the page; the e2e code has no DOM types. */
interface ScrollPage {
  document: {
    querySelector(selector: string): {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    } | null;
  };
  requestAnimationFrame(callback: () => void): void;
  scrollLog: Frame[];
}

/**
 * Starts recording the message list's scroll position every frame, into `scrollLog`.
 * A jump is a frame where the list scrolls back up while following a new message.
 */
const recordScroll = (page: Page) =>
  page.evaluate(() => {
    const view = globalThis as unknown as ScrollPage;
    const scroller = view.document.querySelector('[data-virtuoso-scroller]');
    if (!scroller) throw new Error('no message list');
    const log: Frame[] = [];
    view.scrollLog = log;
    const tick = () => {
      log.push({ top: scroller.scrollTop, height: scroller.scrollHeight - scroller.clientHeight });
      if (log.length < 90) view.requestAnimationFrame(tick);
    };
    view.requestAnimationFrame(tick);
  });

const scrollLog = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as ScrollPage).scrollLog);

/** Every frame's position is at or below the one before, and the last is the end. */
function expectSteadyFollow(log: Frame[]) {
  for (let i = 1; i < log.length; i++) {
    const [before, now] = [log[i - 1], log[i]];
    if (!before || !now) continue;
    expect(now.top, `frame ${String(i)} scrolled back up`).toBeGreaterThanOrEqual(before.top - 2);
  }
  const last = log.at(-1);
  expect(last && last.height - last.top).toBeLessThan(2);
}

test('follows new messages to the end without jumping', async ({ desktop }) => {
  const ali = await createPerson('Ali Test');
  const bora = await createPerson('Bora Test');
  const room = await createRoom('Uzun Sohbet');
  // More history than fits, of varying heights, so the list scrolls.
  for (let i = 0; i < 40; i++)
    await sendMessage(bora, room.id, `geçmiş ${String(i)} ${'lorem ipsum '.repeat(i % 7)}`);
  const page = await desktop.signedIn(ali);
  await roomButton(page, 'Uzun Sohbet').click();
  await expect(page.getByText('geçmiş 39')).toBeInViewport();

  // Someone else's message, joining their group.
  await recordScroll(page);
  await sendMessage(bora, room.id, 'yeni mesaj');
  await expect(page.getByText('yeni mesaj')).toBeInViewport();
  await page.waitForTimeout(1600); // the recording runs for 90 frames
  expectSteadyFollow(await scrollLog(page));

  // One's own message, starting a new group (the case that jumped: group spacing was a margin).
  await recordScroll(page);
  const composer = page.getByLabel('Mesaj', { exact: true });
  await composer.fill('kendi mesajım');
  await composer.press('Enter');
  await expect(page.getByText('kendi mesajım')).toBeInViewport();
  await page.waitForTimeout(1600);
  expectSteadyFollow(await scrollLog(page));
});
