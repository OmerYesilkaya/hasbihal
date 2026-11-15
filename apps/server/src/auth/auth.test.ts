import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthTokens,
  InviteInfo,
  OneTimeLink,
  SessionList,
  SignedIn,
  User,
  type Role,
} from '@hasbihal/protocol';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { createInvite } from './routes.ts';

let app: FastifyInstance;
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  // All test requests come from one IP; the per-IP limit has its own test below.
  app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', AUTH_RATE_LIMIT_PER_MINUTE: '10000' }), {
    db: testDb.db,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

let counter = 0;
/** A username no other test uses. */
const uniqueName = (base = 'user') => `${base}_${++counter}`;
const PASSWORD = 'çay ve simit 2026';

const post = (url: string, payload: unknown, token?: string) =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const errorCode = (res: LightMyRequestResponse) => ApiError.parse(res.json()).error.code;

async function signUp(
  role: Role = 'member',
  username = uniqueName(),
  password = PASSWORD,
): Promise<SignedIn> {
  const invite = await createInvite(testDb.db, role, null);
  const res = await post('/auth/sign-up', {
    inviteToken: invite.token,
    username,
    displayName: 'Ömer Faruk',
    password,
    deviceName: 'Test Mac',
  });
  expect(res.statusCode, res.body).toBe(201);
  return SignedIn.parse(res.json());
}

describe('invites and sign-up', () => {
  it('shows what an invite is for before signing up', async () => {
    const invite = await createInvite(testDb.db, 'admin', null);
    expect(invite.url).toBe(`hasbihal://invite/${invite.token}`);
    const res = await get(`/auth/invites/${invite.token}`);
    expect(InviteInfo.parse(res.json()).role).toBe('admin');
  });

  it('signs up through an invite, with the invite deciding the role', async () => {
    const { user, tokens } = await signUp('admin');
    expect(user.role).toBe('admin');
    expect(user.displayName).toBe('Ömer Faruk');
    expect(User.parse((await get('/me', tokens.accessToken)).json()).id).toBe(user.id);
  });

  it('uses an invite only once', async () => {
    const invite = await createInvite(testDb.db, 'member', null);
    const body = (username: string) => ({
      inviteToken: invite.token,
      username,
      displayName: 'A',
      password: PASSWORD,
      deviceName: 'D',
    });
    expect((await post('/auth/sign-up', body(uniqueName()))).statusCode).toBe(201);
    const again = await post('/auth/sign-up', body(uniqueName()));
    expect(again.statusCode).toBe(404);
    expect((await get(`/auth/invites/${invite.token}`)).statusCode).toBe(404);
  });

  it('rejects expired and unknown invites', async () => {
    const expired = await createInvite(testDb.db, 'member', null, -1000);
    expect((await get(`/auth/invites/${expired.token}`)).statusCode).toBe(404);
    const res = await post('/auth/sign-up', {
      inviteToken: 'nope',
      username: uniqueName(),
      displayName: 'A',
      password: PASSWORD,
      deviceName: 'D',
    });
    expect(res.statusCode).toBe(404);
  });

  it('enforces the username rules (A53), lowercasing what it can', async () => {
    const invite = await createInvite(testDb.db, 'member', null);
    const attempt = (username: string) =>
      post('/auth/sign-up', {
        inviteToken: invite.token,
        username,
        displayName: 'A',
        password: PASSWORD,
        deviceName: 'D',
      });
    for (const bad of ['ab', 'ömer', 'has space', 'a'.repeat(21), 'dash-ed']) {
      const res = await attempt(bad);
      expect(res.statusCode, bad).toBe(400);
      expect(ApiError.parse(res.json()).error.issues?.[0]?.path).toEqual(['body', 'username']);
    }
    const name = uniqueName('Mixed');
    const ok = SignedIn.parse((await attempt(name)).json());
    expect(ok.user.username).toBe(name.toLowerCase());
  });

  it('refuses a taken username with conflict', async () => {
    const { user } = await signUp();
    const invite = await createInvite(testDb.db, 'member', null);
    const res = await post('/auth/sign-up', {
      inviteToken: invite.token,
      username: user.username,
      displayName: 'B',
      password: PASSWORD,
      deviceName: 'D',
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('conflict');
    // The invite is still unused: the failed sign-up rolled back.
    expect((await get(`/auth/invites/${invite.token}`)).statusCode).toBe(200);
  });

  it('refuses short, common, and username-containing passwords', async () => {
    const invite = await createInvite(testDb.db, 'member', null);
    const username = uniqueName('kerem');
    const cases = [
      ['short', undefined],
      ['qwertyuiop', 'password_too_common'],
      [`${username}2026!`, 'password_contains_username'],
    ] as const;
    for (const [password, code] of cases) {
      const res = await post('/auth/sign-up', {
        inviteToken: invite.token,
        username,
        displayName: 'K',
        password,
        deviceName: 'D',
      });
      expect(res.statusCode, password).toBe(400);
      expect(ApiError.parse(res.json()).error.issues?.[0]?.code, password).toBe(code);
    }
  });
});

describe('sign-in', () => {
  it('signs in with username and password, case-insensitive username', async () => {
    const { user } = await signUp();
    const res = await post('/auth/sign-in', {
      username: user.username.toUpperCase(),
      password: PASSWORD,
      deviceName: 'Windows PC',
    });
    expect(res.statusCode).toBe(200);
    expect(SignedIn.parse(res.json()).user.id).toBe(user.id);
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const { user } = await signUp();
    const wrong = await post('/auth/sign-in', {
      username: user.username,
      password: 'wrong password!',
      deviceName: 'D',
    });
    const unknown = await post('/auth/sign-in', {
      username: uniqueName('ghost'),
      password: PASSWORD,
      deviceName: 'D',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('pauses an account after 5 failed attempts', async () => {
    const { user } = await signUp();
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await post('/auth/sign-in', {
            username: user.username,
            password: 'wrong password!',
            deviceName: 'D',
          })
        ).statusCode,
      ).toBe(401);
    }
    const blocked = await post('/auth/sign-in', {
      username: user.username,
      password: PASSWORD,
      deviceName: 'D',
    });
    expect(blocked.statusCode).toBe(429);
    expect(errorCode(blocked)).toBe('rate_limited');
  });

  it('keeps removed members out', async () => {
    const { user, tokens } = await signUp();
    await testDb.db
      .updateTable('users')
      .set({ removed_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    expect(
      (
        await post('/auth/sign-in', {
          username: user.username,
          password: PASSWORD,
          deviceName: 'D',
        })
      ).statusCode,
    ).toBe(401);
    expect((await get('/me', tokens.accessToken)).statusCode).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: tokens.refreshToken })).statusCode).toBe(
      401,
    );
  });
});

describe('tokens and sessions', () => {
  it('requires a valid access token', async () => {
    expect((await get('/me')).statusCode).toBe(401);
    expect((await get('/me', 'not.a.jwt')).statusCode).toBe(401);
  });

  it('rotates the refresh token on every use', async () => {
    const { tokens } = await signUp();
    const first = AuthTokens.parse(
      (await post('/auth/refresh', { refreshToken: tokens.refreshToken })).json(),
    );
    expect(first.refreshToken).not.toBe(tokens.refreshToken);
    expect(first.sessionId).toBe(tokens.sessionId);
    const second = await post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(second.statusCode).toBe(200);
  });

  it('revokes the session when an old refresh token is replayed', async () => {
    const { tokens } = await signUp();
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
    const { user, tokens } = await signUp();
    const other = SignedIn.parse(
      (
        await post('/auth/sign-in', {
          username: user.username,
          password: PASSWORD,
          deviceName: 'PC',
        })
      ).json(),
    );
    expect((await post('/auth/sign-out', {}, tokens.accessToken)).statusCode).toBe(204);
    expect((await get('/me', tokens.accessToken)).statusCode).toBe(401);
    expect((await get('/me', other.tokens.accessToken)).statusCode).toBe(200);
  });

  it('lists sessions and revokes another device', async () => {
    const { user, tokens } = await signUp();
    const pc = SignedIn.parse(
      (
        await post('/auth/sign-in', {
          username: user.username,
          password: PASSWORD,
          deviceName: 'Windows PC',
        })
      ).json(),
    );
    const list = SessionList.parse((await get('/me/sessions', tokens.accessToken)).json());
    expect(list.sessions.map((s) => [s.deviceName, s.current]).sort()).toEqual([
      ['Test Mac', true],
      ['Windows PC', false],
    ]);
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/sessions/${pc.tokens.sessionId}`,
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect((await get('/me', pc.tokens.accessToken)).statusCode).toBe(401);
  });

  it("can't revoke someone else's session", async () => {
    const a = await signUp();
    const b = await signUp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/sessions/${b.tokens.sessionId}`,
      headers: { authorization: `Bearer ${a.tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect((await get('/me', b.tokens.accessToken)).statusCode).toBe(200);
  });
});

describe('admin actions', () => {
  it('lets admins create invites, and not members', async () => {
    const admin = await signUp('admin');
    const member = await signUp('member');
    const res = await post('/invites', { role: 'member' }, admin.tokens.accessToken);
    expect(res.statusCode).toBe(201);
    expect(OneTimeLink.parse(res.json()).url).toMatch(/^hasbihal:\/\/invite\//);
    const denied = await post('/invites', {}, member.tokens.accessToken);
    expect(denied.statusCode).toBe(403);
    expect(errorCode(denied)).toBe('forbidden');
  });

  it('recovers an account: new password, every old session ends (A25)', async () => {
    const admin = await signUp('admin');
    const { user, tokens } = await signUp();
    const link = OneTimeLink.parse(
      (await post(`/users/${user.id}/recovery-link`, {}, admin.tokens.accessToken)).json(),
    );
    expect(link.url).toMatch(/^hasbihal:\/\/recover\//);

    const newPassword = 'yeni bir parola 42';
    const recovered = await post('/auth/recover', {
      recoveryToken: link.token,
      newPassword,
      deviceName: 'New PC',
    });
    expect(recovered.statusCode).toBe(200);
    expect(SignedIn.parse(recovered.json()).user.id).toBe(user.id);

    expect((await get('/me', tokens.accessToken)).statusCode).toBe(401);
    expect(
      (
        await post('/auth/sign-in', {
          username: user.username,
          password: PASSWORD,
          deviceName: 'D',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await post('/auth/sign-in', {
          username: user.username,
          password: newPassword,
          deviceName: 'D',
        })
      ).statusCode,
    ).toBe(200);
    // Single use.
    expect(
      (
        await post('/auth/recover', {
          recoveryToken: link.token,
          newPassword: 'başka bir parola 7',
          deviceName: 'D',
        })
      ).statusCode,
    ).toBe(404);
  });

  it("doesn't let members create recovery links", async () => {
    const member = await signUp();
    const res = await post(`/users/${member.user.id}/recovery-link`, {}, member.tokens.accessToken);
    expect(res.statusCode).toBe(403);
  });
});

describe('per-IP rate limit', () => {
  it('limits the unauthenticated auth routes per IP', async () => {
    const limited = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent', AUTH_RATE_LIMIT_PER_MINUTE: '3' }),
      {
        db: testDb.db,
      },
    );
    try {
      const attempt = () =>
        limited.inject({
          method: 'POST',
          url: '/auth/sign-in',
          payload: { username: 'x', password: 'y', deviceName: 'D' },
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
