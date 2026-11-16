import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hasbihal/core';
import {
  Attachment,
  FileUrls,
  Message,
  Room,
  UPLOAD_MAX_BYTES,
  type SignedIn,
} from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';
import { collectOrphanFiles, ORPHAN_AFTER_MS } from './gc.ts';
import { LocalFileStore } from './store.ts';

let h: Harness;
let admin: SignedIn;
let ayse: SignedIn;
let room: Room;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
  ayse = await h.signUp();
  room = Room.parse((await h.request('POST', '/rooms', as(admin), { name: 'Fotoğraflar' })).json());
});
afterAll(async () => {
  await h.close();
});

const as = (who: SignedIn) => who.tokens.accessToken;

/** A multipart body with one file, as the app sends it. */
function multipart(data: Buffer, filename: string, mime: string) {
  const boundary = '----hasbihal-test';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(who: SignedIn, data: Buffer, filename: string, mime: string) {
  const body = multipart(data, filename, mime);
  return h.app.inject({
    method: 'POST',
    url: '/files',
    headers: { authorization: `Bearer ${as(who)}`, ...body.headers },
    payload: body.payload,
  });
}

const uploaded = async (who: SignedIn, data: Buffer, filename: string, mime: string) => {
  const res = await upload(who, data, filename, mime);
  expect(res.statusCode, res.body).toBe(201);
  return Attachment.parse(res.json());
};

/** A 1200×800 photo stored sideways with EXIF orientation 6, as phones do. */
const photo = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: '#9b2335' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

const send = (who: SignedIn, attachmentIds: string[], body = '') =>
  h.request('POST', `/rooms/${room.id}/messages`, as(who), { id: newId(), body, attachmentIds });

const urlsFor = async (who: SignedIn, ids: string[]) =>
  FileUrls.parse((await h.request('POST', '/files/urls', as(who), { ids })).json()).urls;

/** A request with no access token at all, as an `<img>` makes it. */
const fetchPlain = (url: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, headers });

describe('attachments (A26)', () => {
  it('keeps a photo as it is, makes a thumbnail, and sends it with or without words', async () => {
    const original = await photo();
    const file = await uploaded(admin, original, 'Bayram sofrası.jpg', 'image/jpeg');
    expect(file).toMatchObject({
      kind: 'image',
      name: 'Bayram sofrası.jpg',
      mime: 'image/jpeg',
      size: original.length,
      // As shown: EXIF orientation 6 turns it upright.
      width: 800,
      height: 1200,
      hasThumbnail: true,
    });

    const sent = await send(admin, [file.id]);
    expect(sent.statusCode, sent.body).toBe(201);
    expect(Message.parse(sent.json()).attachments).toEqual([file]);

    // Another member loads it through signed addresses, without the access token.
    const urls = await urlsFor(ayse, [file.id]);
    const url = urls[file.id];
    if (!url?.thumbnail) throw new Error('no thumbnail address');
    const res = await fetchPlain(url.original);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(original)).toBe(true); // never recompressed
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent('Bayram sofrası.jpg')}`,
    );
    const thumb = await fetchPlain(url.thumbnail);
    expect(thumb.headers['content-type']).toBe('image/webp');
    const meta = await sharp(thumb.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([533, 800]);
  });

  it('refuses forged, reused, and expired addresses', async () => {
    const file = await uploaded(admin, await photo(), 'a.jpg', 'image/jpeg');
    const url = (await urlsFor(admin, [file.id]))[file.id];
    if (!url) throw new Error('no address');
    const forged = url.original.replace(/s=[^&]+/, 's=AAAA');
    expect((await fetchPlain(forged)).statusCode).toBe(403);
    // The original's signature doesn't open the thumbnail, or another file.
    const other = await uploaded(admin, await photo(), 'b.jpg', 'image/jpeg');
    expect((await fetchPlain(url.original.replace('?', '/thumbnail?'))).statusCode).toBe(403);
    expect((await fetchPlain(url.original.replace(file.id, other.id))).statusCode).toBe(403);
    const expired = url.original.replace(/e=\d+/, 'e=1000');
    expect((await fetchPlain(expired)).statusCode).toBe(403);
    // Without any signature, it takes the access token.
    expect((await fetchPlain(`/files/${file.id}`)).statusCode).toBe(401);
  });

  it('serves byte ranges, so videos can seek', async () => {
    const data = Buffer.from('0123456789'.repeat(100));
    const file = await uploaded(admin, data, 'notlar.txt', 'text/plain');
    const url = (await urlsFor(admin, [file.id]))[file.id]?.original ?? '';
    const part = await fetchPlain(url, { range: 'bytes=10-19' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 10-19/1000');
    expect(part.body).toBe('0123456789');
    const tail = await fetchPlain(url, { range: 'bytes=-5' });
    expect(tail.body).toBe('56789');
    const bad = await fetchPlain(url, { range: 'bytes=2000-' });
    expect(bad.statusCode).toBe(416);
  });

  it('offers anything it would not show as a download, never as a page', async () => {
    const page = Buffer.from('<script>alert(1)</script>');
    const file = await uploaded(admin, page, 'ödev.html', 'text/html');
    expect(file).toMatchObject({ kind: 'other', mime: 'application/octet-stream' });
    const res = await fetchPlain((await urlsFor(admin, [file.id]))[file.id]?.original ?? '');
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('ödev.html')}`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('attaches only your own files, each once, and needs words or a file', async () => {
    const mine = await uploaded(admin, await photo(), 'c.jpg', 'image/jpeg');
    expect((await send(ayse, [mine.id])).statusCode).toBe(400);
    expect((await send(admin, [mine.id, mine.id])).statusCode).toBe(400);
    expect((await send(admin, [mine.id], 'İlk')).statusCode).toBe(201);
    expect((await send(admin, [mine.id], 'Yine')).statusCode).toBe(400);
    expect((await send(admin, [])).statusCode).toBe(400);
  });

  it('lets a caption be removed only while files remain', async () => {
    const file = await uploaded(admin, await photo(), 'd.jpg', 'image/jpeg');
    const withFile = Message.parse((await send(admin, [file.id], 'Bakın')).json());
    const edited = await h.request('PATCH', `/messages/${withFile.id}`, as(admin), { body: '' });
    expect(edited.statusCode).toBe(200);
    const plain = Message.parse((await send(admin, [], 'Sadece yazı')).json());
    const emptied = await h.request('PATCH', `/messages/${plain.id}`, as(admin), { body: '' });
    expect(emptied.statusCode).toBe(400);
  });

  it('refuses files over 100 MB', async () => {
    const res = await upload(admin, Buffer.alloc(UPLOAD_MAX_BYTES + 1), 'büyük.bin', 'x/y');
    expect(res.statusCode).toBe(413);
  });
});

describe('unused files', () => {
  it('removes abandoned uploads and the files of deleted messages, nothing else', async () => {
    const kept = await uploaded(admin, await photo(), 'kalsın.jpg', 'image/jpeg');
    await send(admin, [kept.id]);
    const abandoned = await uploaded(admin, await photo(), 'gönderilmedi.jpg', 'image/jpeg');
    const deletedWith = await uploaded(admin, await photo(), 'silinecek.jpg', 'image/jpeg');
    const message = Message.parse((await send(admin, [deletedWith.id])).json());
    expect((await h.request('DELETE', `/messages/${message.id}`, as(admin))).statusCode).toBe(204);

    const store = new LocalFileStore(h.filesDir);
    const later = new Date(Date.now() + ORPHAN_AFTER_MS + 60_000);
    // Other tests' uploads may go too; these three are what matters.
    await collectOrphanFiles(h.testDb.db, store, later);
    const remaining = new Set(
      (await h.testDb.db.selectFrom('files').select('id').execute()).map((f) => f.id),
    );
    expect(remaining.has(kept.id)).toBe(true);
    expect(remaining.has(abandoned.id)).toBe(false);
    expect(remaining.has(deletedWith.id)).toBe(false);
    const onDisk = await readdir(h.filesDir, { recursive: true });
    expect(onDisk.some((f) => f.includes(abandoned.id))).toBe(false);
    expect(onDisk.some((f) => f.includes(kept.id))).toBe(true);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('videos (with ffmpeg)', () => {
  it('reads size and duration, and makes a poster frame', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hasbihal-video-'));
    try {
      const file = path.join(dir, 'test.mp4');
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=3:size=320x240:rate=10',
        '-pix_fmt',
        'yuv420p',
        file,
      ]);
      const video = await uploaded(admin, await readFile(file), 'Doğum günü.mp4', 'video/mp4');
      expect(video).toMatchObject({ kind: 'video', mime: 'video/mp4', width: 320, height: 240 });
      expect(video.durationMs).toBeGreaterThan(2500);
      expect(video.hasThumbnail).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
