import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleSignIn, type GoogleClient } from './google-sign-in.ts';

/** Google's two endpoints, as far as the flow needs them, with PKCE checked for real. */
let google: Server;
let client: GoogleClient;
/** What /authorize does next: sign in, refuse, or leave the person on the page. */
let behaviour: 'approve' | 'deny' | 'wait' = 'approve';
const challenges = new Map<string, string>();
let lastAuthorize: URLSearchParams | undefined;

beforeAll(async () => {
  google = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    if (url.pathname === '/authorize') {
      lastAuthorize = url.searchParams;
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      if (behaviour === 'wait') {
        // Google's page stays open, nobody signs in.
        response.writeHead(200, { 'content-type': 'text/html' }).end('<p>Hesap seçin</p>');
        return;
      }
      if (behaviour === 'deny') back.searchParams.set('error', 'access_denied');
      else {
        const code = `code-${String(challenges.size)}`;
        challenges.set(code, url.searchParams.get('code_challenge') ?? '');
        back.searchParams.set('code', code);
      }
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const form = new URLSearchParams(body);
      const expected = challenges.get(form.get('code') ?? '');
      const actual = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      const ok = expected === actual && form.get('client_secret') === 'sır';
      response.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
      response.end(JSON.stringify(ok ? { id_token: 'the-id-token' } : { error: 'invalid_grant' }));
    });
  });
  await new Promise<void>((resolve) => google.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${String((google.address() as AddressInfo).port)}`;
  client = {
    clientId: 'hasbihal-desktop',
    clientSecret: 'sır',
    authUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
  };
});

afterAll(() => {
  google.close();
});

/** The "browser": follows Google's redirect back to the app, like a real one would. */
const browser = async (url: string) => {
  await fetch(url).catch(() => undefined);
};

describe('Google sign-in from the desktop app', () => {
  it('returns the ID token after the browser comes back with a code', async () => {
    behaviour = 'approve';
    const signIn = new GoogleSignIn({ client, openBrowser: browser, loginHint: 'a@gmail.com' });
    expect(await signIn.run()).toEqual({ ok: true, idToken: 'the-id-token' });
    expect(lastAuthorize?.get('scope')).toBe('openid email profile');
    expect(lastAuthorize?.get('code_challenge_method')).toBe('S256');
    expect(lastAuthorize?.get('login_hint')).toBe('a@gmail.com');
    expect(lastAuthorize?.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('treats declining at Google as cancelled', async () => {
    behaviour = 'deny';
    const signIn = new GoogleSignIn({ client, openBrowser: browser });
    expect(await signIn.run()).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('can be cancelled while the browser is open, and gives up after its timeout', async () => {
    behaviour = 'wait';
    const signIn = new GoogleSignIn({ client, openBrowser: browser });
    const running = signIn.run();
    await new Promise((r) => setTimeout(r, 50));
    signIn.cancel();
    expect(await running).toEqual({ ok: false, reason: 'cancelled' });

    const impatient = new GoogleSignIn({ client, openBrowser: browser, timeoutMs: 50 });
    expect(await impatient.run()).toEqual({ ok: false, reason: 'timeout' });
  });

  it('ignores a callback that isn’t for this sign-in', async () => {
    behaviour = 'approve';
    let forged = 0;
    const signIn = new GoogleSignIn({
      client,
      openBrowser: async (url) => {
        // Another page on this computer guesses the port, without the state.
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', 'stolen');
        forged = (await fetch(redirect)).status;
        await browser(url);
      },
    });
    expect(await signIn.run()).toEqual({ ok: true, idToken: 'the-id-token' });
    expect(forged).toBe(404);
  });

  it('fails when the code can’t be traded for a token', async () => {
    behaviour = 'approve';
    const signIn = new GoogleSignIn({
      client: { ...client, clientSecret: 'yanlış' },
      openBrowser: browser,
    });
    expect(await signIn.run()).toEqual({ ok: false, reason: 'failed' });
  });
});
