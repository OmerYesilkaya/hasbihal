import { describe, expect, it } from 'vitest';
import type { AuthTokens, User } from '@hasbihal/protocol';
import { AuthSession, type TokenStore } from './auth-session.ts';

const USER: User = {
  id: '0192f0c4-7b5e-7c8e-9a3b-1234567890ab',
  username: 'omer',
  displayName: 'Ömer',
  avatarColor: 3,
  avatarFileId: null,
  role: 'admin',
  createdAt: '2026-11-15T10:00:00.000Z',
  removedAt: null,
};
const SESSION_ID = '0192f0c4-7b5e-7c8e-9a3b-1234567890ac';

class MemoryStore implements TokenStore {
  token: string | null;
  constructor(token: string | null = null) {
    this.token = token;
  }
  load() {
    return Promise.resolve(this.token);
  }
  save(token: string | null) {
    this.token = token;
    return Promise.resolve();
  }
}

/** A tiny stand-in for the server: rotating refresh tokens, and switches for offline and revoked. */
class FakeServer {
  now = Date.parse('2026-11-15T12:00:00Z');
  offline = false;
  revoked = false;
  refreshCalls = 0;
  signOutCalls = 0;
  #generation = 0;
  validRefresh = 'refresh-0';

  tokens(): AuthTokens {
    this.#generation++;
    this.validRefresh = `refresh-${String(this.#generation)}`;
    return {
      sessionId: SESSION_ID,
      accessToken: `access-${String(this.#generation)}`,
      accessTokenExpiresAt: new Date(this.now + 15 * 60_000).toISOString(),
      refreshToken: this.validRefresh,
    };
  }

  fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    if (this.offline) throw new TypeError('fetch failed');
    const url = new URL(input instanceof Request ? input.url : String(input));
    // AuthSession always sends JSON strings.
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {};
    const json = (status: number, payload: unknown) =>
      new Response(status === 204 ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const denied = json(401, { error: { code: 'unauthorized', message: 'no' } });

    switch (url.pathname) {
      case '/auth/sign-in':
        return body.password === 'right password'
          ? json(200, { user: USER, tokens: this.tokens() })
          : json(401, { error: { code: 'unauthorized', message: 'Wrong username or password.' } });
      case '/auth/refresh':
        this.refreshCalls++;
        if (this.revoked || body.refreshToken !== this.validRefresh) return denied;
        return json(200, this.tokens());
      case '/me':
        return this.revoked ? denied : json(200, USER);
      case '/auth/sign-out':
        this.signOutCalls++;
        return json(204, null);
      default:
        return json(404, { error: { code: 'not_found', message: 'no route' } });
    }
  };
}

function setup(stored: string | null = null) {
  const server = new FakeServer();
  if (stored) server.validRefresh = stored;
  const store = new MemoryStore(stored);
  const session = new AuthSession({
    serverUrl: 'http://server.test',
    deviceName: 'Test Mac',
    store,
    fetch: server.fetch,
    now: () => server.now,
  });
  return { server, store, session };
}

describe('AuthSession', () => {
  it('signs in and keeps only the refresh token in the store', async () => {
    const { session, store } = setup();
    const result = await session.signIn({ username: 'omer', password: 'right password' });
    expect(result).toEqual({ ok: true, value: USER });
    expect(store.token).toBe('refresh-1');
    expect(await session.accessToken()).toEqual({ ok: true, value: 'access-1' });
  });

  it('passes server errors through unchanged', async () => {
    const { session, store } = setup();
    const result = await session.signIn({ username: 'omer', password: 'wrong' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Wrong username or password.' },
    });
    expect(store.token).toBeNull();
  });

  it('restores a stored session on startup', async () => {
    const { session, store } = setup('refresh-stored');
    expect(await session.restore()).toEqual({ ok: true, value: USER });
    expect(store.token).toBe('refresh-1'); // rotated
  });

  it('starts signed out without a stored session', async () => {
    const { session, server } = setup();
    expect(await session.restore()).toEqual({ ok: true, value: null });
    expect(server.refreshCalls).toBe(0);
  });

  it('refreshes only once for concurrent requests (a second use would look like theft)', async () => {
    const { session, server } = setup('refresh-stored');
    const results = await Promise.all([
      session.accessToken(),
      session.accessToken(),
      session.accessToken(),
    ]);
    expect(server.refreshCalls).toBe(1);
    expect(results.every((r) => r.ok && r.value === 'access-1')).toBe(true);
  });

  it('refreshes shortly before the access token expires', async () => {
    const { session, server } = setup();
    await session.signIn({ username: 'omer', password: 'right password' });
    server.now += 13 * 60_000; // 2 minutes left: still fine
    expect(await session.accessToken()).toEqual({ ok: true, value: 'access-1' });
    server.now += 90_000; // 30 seconds left: refresh now
    expect(await session.accessToken()).toEqual({ ok: true, value: 'access-2' });
  });

  it('keeps the session while offline', async () => {
    const { session, server, store } = setup('refresh-stored');
    server.offline = true;
    const result = await session.restore();
    expect(result.ok ? null : result.error.code).toBe('unavailable');
    expect(store.token).toBe('refresh-stored');
    server.offline = false;
    expect(await session.restore()).toEqual({ ok: true, value: USER });
  });

  it('ends the session when the server rejects it, and says so once', async () => {
    const { session, server, store } = setup('refresh-stored');
    await session.restore();
    let ended = 0;
    session.onSessionEnded(() => ended++);
    server.revoked = true;
    server.now += 15 * 60_000; // force a refresh
    const result = await session.accessToken();
    expect(result.ok ? null : result.error.code).toBe('unauthorized');
    expect(store.token).toBeNull();
    expect(ended).toBe(1);
    await session.accessToken();
    expect(ended).toBe(1);
  });

  it('signs out on the server and forgets the token', async () => {
    const { session, server, store } = setup();
    await session.signIn({ username: 'omer', password: 'right password' });
    let ended = 0;
    session.onSessionEnded(() => ended++);
    await session.signOut();
    expect(server.signOutCalls).toBe(1);
    expect(store.token).toBeNull();
    expect(ended).toBe(0); // the user chose it; nothing to announce
    expect((await session.restore()).ok).toBe(true);
  });
});
