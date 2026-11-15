import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hasbihal/core';
import { Message, MessagePage, Room, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';
import { SafeFetcher } from './fetcher.ts';

let site: Server;
let base: string;
let pageHits = 0;
let h: Harness;
let admin: SignedIn;
let room: Room;

beforeAll(async () => {
  const picture = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#4a6b2a' },
  })
    .png()
    .toBuffer();
  site = createServer((request, response) => {
    if (request.url === '/tarif') {
      pageHits++;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<head><meta property="og:title" content="Kuru fasulye">
        <meta property="og:description" content="Annemin tarifi.">
        <meta property="og:site_name" content="Lezzet">
        <meta property="og:image" content="/kapak.png"></head>`);
    } else if (request.url === '/kapak.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(picture);
    } else if (request.url === '/bos') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<head></head>');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((site.address() as AddressInfo).port)}`;
  // The real fetcher, allowed to reach this local stand-in for a website.
  h = await startHarness({ fetcher: new SafeFetcher({ allowPrivate: true }) });
  admin = await h.signUp('admin');
  room = Room.parse((await h.request('POST', '/rooms', as(admin), { name: 'Mutfak' })).json());
});
afterAll(async () => {
  await h.close();
  site.close();
});

const as = (who: SignedIn) => who.tokens.accessToken;

const send = async (body: string) => {
  const res = await h.request('POST', `/rooms/${room.id}/messages`, as(admin), {
    id: newId(),
    body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return Message.parse(res.json());
};

describe('link previews (A24)', () => {
  it('fetches a link once, shows it on every message that has it, and updates them live', async () => {
    const client = await h.connect(as(admin));
    await client.waitFor('welcome');

    const first = await send(`Bunu yapalım: ${base}/tarif`);
    expect(first.previews).toEqual([]); // fetched in the background
    await h.app.jobs.runDue();
    await h.hub.settled();

    const updated = await client.waitFor(
      'event',
      (m) => m.event.type === 'message_updated' && m.event.message.id === first.id,
    );
    if (updated.event.type !== 'message_updated') throw new Error('unexpected event');
    const [preview] = updated.event.message.previews;
    expect(preview).toMatchObject({
      url: `${base}/tarif`,
      title: 'Kuru fasulye',
      description: 'Annemin tarifi.',
      siteName: 'Lezzet',
      image: { kind: 'image', mime: 'image/webp', width: 1200, height: 675 },
    });

    // The same link again: the cached preview, no second fetch.
    const second = await send(`${base}/tarif tekrar`);
    expect(second.previews).toEqual(updated.event.message.previews);
    await h.app.jobs.runDue();
    expect(pageHits).toBe(1);
    client.ws.terminate();
  });

  it('shows nothing for pages without a title, and drops previews with the link', async () => {
    const bare = await send(`${base}/bos`);
    await h.app.jobs.runDue();
    const page = MessagePage.parse(
      (await h.request('GET', `/rooms/${room.id}/messages`, as(admin))).json(),
    );
    const loaded = page.messages.at(-1);
    if (!loaded) throw new Error('no messages');
    expect(loaded.id).toBe(bare.id);
    expect(loaded.previews).toEqual([]);

    const linked = await send(`${base}/tarif`);
    expect(linked.previews).toHaveLength(1);
    const edited = Message.parse(
      (await h.request('PATCH', `/messages/${linked.id}`, as(admin), { body: 'Vazgeçtim' })).json(),
    );
    expect(edited.previews).toEqual([]);
  });
});
