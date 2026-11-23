import type { LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { newId } from '@hasbihal/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccessList,
  ApiError,
  AuthTokens,
  GoogleSignInResult,
  SessionList,
  type SignedIn,
} from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';
import { TEST_GOOGLE_CLIENT_ID, type GoogleAccount } from '../../test/google.ts';
import type { Fetcher } from '../previews/fetcher.ts';
import { photoUrlAtSize } from './google-photo.ts';

/** What the stand-in fetcher hands out as everyone's Google photo. */
let photo: Buffer;
const fetched: string[] = [];
const photoFetcher: Fetcher = {
  fetch: (url) => {
    fetched.push(url);
    return Promise.resolve({ url, contentType: 'image/png', body: photo });
  },
};

let h: Harness;
let admin: SignedIn;
beforeAll(async () => {
  photo = await sharp({
    create: { width: 96, height: 96, channels: 3, background: '#c0392b' },
  })
    .png()
    .toBuffer();
  h = await startHarness({ fetcher: photoFetcher });
  admin = await h.signUp('admin');
});
afterAll(async () => {
  await h.close();
});

const errorCode = (res: LightMyRequestResponse) => ApiError.parse(res.json()).error.code;
const result = (res: LightMyRequestResponse) => GoogleSignInResult.parse(res.json());
const post = (url: string, payload: object, token?: string) =>
  h.app.inject({
    method: 'POST',
    url,
    payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const get = (url: string, token?: string) =>
  h.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const allow = (email: string, role: 'admin' | 'member' = 'member') =>
  h.testDb.db.insertInto('allowed_emails').values({ email, role, added_by: null }).execute();
/** A member made before Google sign-in, given their address with `set-email`. */
const oldMember = async (account: GoogleAccount, username: string) =>
  h.testDb.db
    .insertInto('users')
    .values({
      id: newId(),
      username,
      display_name: 'Eski Üye',
      avatar_color: 3,
      role: 'member',
      email: account.email,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
const signedIn = (res: LightMyRequestResponse) => {
  const r = result(res);
  if (r.status !== 'signed_in') throw new Error(`not signed in: ${res.body}`);
  return r;
};

describe('signing in with Google (A25)', () => {
  it('makes an account for an address on the list: name from Google, role from the list', async () => {
    const watcher = await h.connect(admin.tokens.accessToken);
    await watcher.waitFor('welcome');
    const account = { ...h.google.account('Ayşe Yılmaz'), email: 'ayse.yilmaz.a1@gmail.com' };
    await allow(account.email, 'admin');

    const res = await h.signInWithGoogle(account);
    expect(res.statusCode).toBe(200);
    const { user } = signedIn(res);
    expect(user).toMatchObject({
      displayName: 'Ayşe Yılmaz',
      username: 'ayse.yilmaz.a1',
      role: 'admin',
      avatarFileId: null,
    });
    await watcher.waitFor(
      'event',
      (m) => m.event.type === 'member_joined' && m.event.user.id === user.id,
    );
    watcher.ws.terminate();
    // The address was used up: the list is for people who haven't joined yet.
    const left = await h.testDb.db
      .selectFrom('allowed_emails')
      .where('email', '=', account.email)
      .selectAll()
      .execute();
    expect(left).toEqual([]);
  });

  it('signs the same Google account back in, even after its address changed', async () => {
    const member = await h.signUp();
    const renamed = { ...member.account, email: `yeni.${member.account.email}` };
    const again = signedIn(await h.signInWithGoogle(renamed));
    expect(again.user.id).toBe(member.user.id);
  });

  it('numbers the @handle when the address’s is taken', async () => {
    const first = { ...h.google.account(), email: 'mehmet.b2@gmail.com' };
    const second = { ...h.google.account(), email: 'mehmet.b2@googlemail.com' };
    await allow(first.email);
    await allow(second.email);
    expect(signedIn(await h.signInWithGoogle(first)).user.username).toBe('mehmet.b2');
    expect(signedIn(await h.signInWithGoogle(second)).user.username).toBe('mehmet.b22');
  });

  it('links a member made before Google sign-in by address, keeping their name and @handle', async () => {
    const account = h.google.account('Google Adı');
    const old = await oldMember(account, 'eskiuye_1');

    const linked = signedIn(await h.signInWithGoogle(account));
    expect(linked.user).toMatchObject({
      id: old.id,
      username: 'eskiuye_1',
      displayName: 'Eski Üye',
    });
    // From now on the Google account is theirs; another one claiming the address isn't.
    const impostor = { ...h.google.account(), email: account.email };
    const res = await h.signInWithGoogle(impostor);
    expect(res.statusCode).toBe(409);
  });

  it('tells someone not on the list so, and records their request once', async () => {
    const memberClient = await h.connect((await h.signUp()).tokens.accessToken);
    const adminClient = await h.connect(admin.tokens.accessToken);
    await memberClient.waitFor('welcome');
    await adminClient.waitFor('welcome');
    const stranger = h.google.account('Yabancı Biri');

    expect(result(await h.signInWithGoogle(stranger))).toEqual({
      status: 'not_allowed',
      email: stranger.email,
      requested: false,
    });
    const request = async () =>
      post('/auth/access-requests', { idToken: await h.google.idToken(stranger) });
    expect((await request()).statusCode).toBe(204);
    expect((await request()).statusCode).toBe(204);

    await adminClient.waitFor('access_requested', (m) => m.email === stranger.email);
    expect(adminClient.messages.filter((m) => m.type === 'access_requested')).toHaveLength(1);
    expect(memberClient.messages.some((m) => m.type === 'access_requested')).toBe(false);
    expect(result(await h.signInWithGoogle(stranger))).toMatchObject({ requested: true });
    const list = AccessList.parse((await get('/admin/access', admin.tokens.accessToken)).json());
    expect(list.requests.find((r) => r.email === stranger.email)?.name).toBe('Yabancı Biri');
    memberClient.ws.terminate();
    adminClient.ws.terminate();
  });

  it('refuses ID tokens that are forged, for another app, expired, or unverified', async () => {
    const account = h.google.account();
    await allow(account.email);
    const tries = [
      { forged: true },
      { audience: 'another-app.apps.googleusercontent.com' },
      { issuer: 'https://evil.example' },
      { expiresIn: -60 },
      { emailVerified: false },
    ];
    for (const options of tries) {
      const res = await post('/auth/google', {
        idToken: await h.google.idToken(account, options),
        deviceName: 'Test',
      });
      expect(res.statusCode, JSON.stringify(options)).toBe(401);
      expect(errorCode(res)).toBe('unauthorized');
    }
    const accepted = await post('/auth/google', {
      idToken: await h.google.idToken(account, { audience: TEST_GOOGLE_CLIENT_ID }),
      deviceName: 'Test',
    });
    expect(accepted.statusCode).toBe(200);
  });

  it('says so when this server has no Google client', async () => {
    const bare = await startHarness({ google: undefined });
    try {
      const res = await bare.app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: 'x', deviceName: 'Test' },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await bare.close();
    }
  });
});

describe('the Google photo (A25, A40)', () => {
  it('becomes a new member’s photo, asked for at the size we keep', async () => {
    const account = {
      ...h.google.account(),
      picture: 'https://lh3.googleusercontent.com/a/foto=s96-c',
    };
    await allow(account.email);
    const { user } = signedIn(await h.signInWithGoogle(account));
    await h.app.jobs.runDue();
    await h.hub.settled();

    expect(fetched).toContain('https://lh3.googleusercontent.com/a/foto=s256-c');
    const stored = await h.testDb.db
      .selectFrom('users')
      .select('avatar_file_id')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(stored.avatar_file_id).not.toBeNull();
  });

  it('never replaces a photo the member chose', async () => {
    const account = { ...h.google.account(), picture: 'https://lh3.googleusercontent.com/b' };
    const old = await oldMember(account, 'fotolu_1');
    const chosen = newId();
    await h.testDb.db
      .insertInto('files')
      .values({
        id: chosen,
        uploader_id: old.id,
        kind: 'image',
        original_name: 'ben.webp',
        mime: 'image/webp',
        size_bytes: 1,
        sha256: Buffer.alloc(32),
        storage_key: `test/${chosen}.webp`,
        width: 256,
        height: 256,
      })
      .execute();
    await h.testDb.db
      .updateTable('users')
      .set({ avatar_file_id: chosen })
      .where('id', '=', old.id)
      .execute();

    signedIn(await h.signInWithGoogle(account));
    await h.app.jobs.runDue();
    const stored = await h.testDb.db
      .selectFrom('users')
      .select('avatar_file_id')
      .where('id', '=', old.id)
      .executeTakeFirstOrThrow();
    expect(stored.avatar_file_id).toBe(chosen);
  });

  it('keeps Google’s size suffix in step with ours', () => {
    expect(photoUrlAtSize('https://x/a=s96-c')).toBe('https://x/a=s256-c');
    expect(photoUrlAtSize('https://x/a=s96')).toBe('https://x/a=s256-c');
    expect(photoUrlAtSize('https://x/a')).toBe('https://x/a');
  });
});

describe('tokens and sessions', () => {
  it('requires a valid access token', async () => {
    expect((await get('/me')).statusCode).toBe(401);
    expect((await get('/me', 'not.a.jwt')).statusCode).toBe(401);
  });

  it('rotates the refresh token on every use', async () => {
    const { tokens } = await h.signUp();
    const first = AuthTokens.parse(
      (await post('/auth/refresh', { refreshToken: tokens.refreshToken })).json(),
    );
    expect(first.refreshToken).not.toBe(tokens.refreshToken);
    expect(first.sessionId).toBe(tokens.sessionId);
    const second = await post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(second.statusCode).toBe(200);
  });

  it('revokes the session when an old refresh token is replayed', async () => {
    const { tokens } = await h.signUp();
    const next = AuthTokens.parse(
      (await post('/auth/refresh', { refreshToken: tokens.refreshToken })).json(),
    );
    // An attacker replays the stolen, already used token…
    expect((await post('/auth/refresh', { refreshToken: tokens.refreshToken })).statusCode).toBe(
      401,
    );
    // …which ends the session for everyone holding it, the legitimate device included.
    expect((await post('/auth/refresh', { refreshToken: next.refreshToken })).statusCode).toBe(401);
    expect((await get('/me', next.accessToken)).statusCode).toBe(401);
  });

  it('signs out the current session only', async () => {
    const member = await h.signUp();
    const other = signedIn(await h.signInWithGoogle(member.account, 'PC'));
    expect((await post('/auth/sign-out', {}, member.tokens.accessToken)).statusCode).toBe(204);
    expect((await get('/me', member.tokens.accessToken)).statusCode).toBe(401);
    expect((await get('/me', other.tokens.accessToken)).statusCode).toBe(200);
  });

  it('lists sessions and revokes another device', async () => {
    const member = await h.signUp();
    const pc = signedIn(await h.signInWithGoogle(member.account, 'Windows PC'));
    const list = SessionList.parse((await get('/me/sessions', member.tokens.accessToken)).json());
    expect(list.sessions.map((s) => [s.deviceName, s.current]).sort()).toEqual([
      ['Test', true],
      ['Windows PC', false],
    ]);
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/me/sessions/${pc.tokens.sessionId}`,
      headers: { authorization: `Bearer ${member.tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect((await get('/me', pc.tokens.accessToken)).statusCode).toBe(401);
  });

  it("can't revoke someone else's session", async () => {
    const a = await h.signUp();
    const b = await h.signUp();
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/me/sessions/${b.tokens.sessionId}`,
      headers: { authorization: `Bearer ${a.tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect((await get('/me', b.tokens.accessToken)).statusCode).toBe(200);
  });
});

describe('per-IP rate limit', () => {
  it('limits the unauthenticated auth routes per IP', async () => {
    const limited = await startHarness({}, { AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { idToken: 'not-a-token', deviceName: 'D' },
        });
      for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
      const res = await attempt();
      expect(res.statusCode).toBe(429);
      expect(errorCode(res)).toBe('rate_limited');
    } finally {
      await limited.close();
    }
  });
});
