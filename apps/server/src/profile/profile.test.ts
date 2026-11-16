import { readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, SignedIn, User, type SignedIn as SignedInType } from '@hasbihal/protocol';
import { PASSWORD, startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const as = (who: SignedInType) => who.tokens.accessToken;

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

async function uploadAvatar(
  who: SignedInType,
  data: Buffer,
  filename = 'foto.jpg',
  mime = 'image/jpeg',
) {
  const body = multipart(data, filename, mime);
  const res = await h.app.inject({
    method: 'PUT',
    url: '/me/avatar',
    headers: { authorization: `Bearer ${as(who)}`, ...body.headers },
    payload: body.payload,
  });
  await h.hub.settled();
  return res;
}

/** A 600×400 photo with EXIF that includes a GPS position. */
const photo = () =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: '#9b2335' } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 0/1 0/1' } })
    .toBuffer();

const storedFiles = async () =>
  (await readdir(h.filesDir, { recursive: true })).filter((f) => f.endsWith('.webp'));

describe('profile photo (A40)', () => {
  it('stores a 256 px WebP without the original metadata, and announces it', async () => {
    const member = await h.signUp();
    const watcher = await h.signUp();
    const client = await h.connect(as(watcher));
    await client.waitFor('welcome');

    const res = await uploadAvatar(member, await photo());
    expect(res.statusCode, res.body).toBe(200);
    const user = User.parse(res.json());
    expect(user.avatarFileId).not.toBeNull();
    await client.waitFor(
      'event',
      (m) => m.event.type === 'member_updated' && m.event.user.avatarFileId === user.avatarFileId,
    );

    const file = await h.request('GET', `/files/${user.avatarFileId ?? ''}`, as(watcher));
    expect(file.headers['content-type']).toBe('image/webp');
    const meta = await sharp(file.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(meta.exif).toBeUndefined(); // no GPS, no camera
    client.ws.terminate();
  });

  it('replaces the old photo and deletes its file, and can remove the photo', async () => {
    const member = await h.signUp();
    const first = User.parse((await uploadAvatar(member, await photo())).json());
    const before = await storedFiles();
    const second = User.parse((await uploadAvatar(member, await photo())).json());
    expect(second.avatarFileId).not.toBe(first.avatarFileId);
    expect(
      (await h.request('GET', `/files/${first.avatarFileId ?? ''}`, as(member))).statusCode,
    ).toBe(404);
    expect(await storedFiles()).toHaveLength(before.length);

    const removed = User.parse((await h.request('DELETE', '/me/avatar', as(member))).json());
    expect(removed.avatarFileId).toBeNull();
    expect(await storedFiles()).toHaveLength(before.length - 1);
  });

  it('refuses files that are not images, and photos over 8 MB', async () => {
    const member = await h.signUp();
    const notImage = await uploadAvatar(
      member,
      Buffer.from('%PDF-1.7 not an image'),
      'cv.pdf',
      'application/pdf',
    );
    expect(notImage.statusCode).toBe(400);
    expect(ApiError.parse(notImage.json()).error.issues?.[0]?.code).toBe('not_an_image');
    const huge = await uploadAvatar(member, Buffer.alloc(9 * 1024 * 1024, 1));
    expect(huge.statusCode).toBe(413);
  });

  it('serves files only to signed-in members', async () => {
    const member = await h.signUp();
    const user = User.parse((await uploadAvatar(member, await photo())).json());
    expect(
      (await h.app.inject({ method: 'GET', url: `/files/${user.avatarFileId ?? ''}` })).statusCode,
    ).toBe(401);
  });
});

describe('profile details (A41)', () => {
  it('changes the display name, and announces it', async () => {
    const member = await h.signUp();
    const watcher = await h.signUp();
    const client = await h.connect(as(watcher));
    await client.waitFor('welcome');
    const res = await h.request('PATCH', '/me', as(member), { displayName: '  Ömer Faruk  ' });
    expect(User.parse(res.json()).displayName).toBe('Ömer Faruk');
    await client.waitFor(
      'event',
      (m) => m.event.type === 'member_updated' && m.event.user.displayName === 'Ömer Faruk',
    );
    client.ws.terminate();
  });

  it('changes the password and signs out the other devices only', async () => {
    const member = await h.signUp();
    const other = SignedIn.parse(
      (
        await h.app.inject({
          method: 'POST',
          url: '/auth/sign-in',
          payload: { username: member.user.username, password: PASSWORD, deviceName: 'PC' },
        })
      ).json(),
    );
    const wrong = await h.request('POST', '/me/password', as(member), {
      currentPassword: 'yanlış parola',
      newPassword: 'yepyeni bir parola 9',
    });
    expect(ApiError.parse(wrong.json()).error.issues?.[0]?.code).toBe('wrong_password');

    const res = await h.request('POST', '/me/password', as(member), {
      currentPassword: PASSWORD,
      newPassword: 'yepyeni bir parola 9',
    });
    expect(res.statusCode).toBe(204);
    expect((await h.request('GET', '/me', as(member))).statusCode).toBe(200);
    expect((await h.request('GET', '/me', as(other))).statusCode).toBe(401);
    const signIn = await h.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: {
        username: member.user.username,
        password: 'yepyeni bir parola 9',
        deviceName: 'Mac',
      },
    });
    expect(signIn.statusCode).toBe(200);
  });
});
