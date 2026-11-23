import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Sign-in with Google for a desktop app (DECISIONS A25), the way RFC 8252 and Google describe it:
 * the person signs in in their own browser, which then calls back to a one-off server on
 * 127.0.0.1 with a code; the app trades the code, with its PKCE verifier, for an ID token. The
 * token goes to the Hasbihal server, which checks it and signs the device in. Nothing is kept:
 * Google is only asked who this is.
 */

export interface GoogleClient {
  /** A "Desktop app" OAuth client. Google treats its secret as public: it ships in the app. */
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
}

export const GOOGLE_ENDPOINTS = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
};

export type GoogleSignInOutcome =
  | { ok: true; idToken: string }
  /**
   * `cancelled`: by the app, or the person declined at Google; `timeout`: they never finished;
   * `failed`: Google or the network failed us.
   */
  | { ok: false; reason: 'cancelled' | 'timeout' | 'failed' };

export interface GoogleSignInOptions {
  client: GoogleClient;
  /** Shows Google's page: the system browser, or a stand-in in tests. */
  openBrowser: (url: string) => Promise<void>;
  /** Suggests an account on Google's page (`login_hint`). */
  loginHint?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Long enough to type a password and a second factor; after that, the server stops waiting. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 15_000;

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** What the browser tab shows once Google has called back: the rest happens in the app. */
function page(done: boolean): string {
  const [tr, en] = done
    ? ['Giriş tamam. Hasbihal’a dönebilirsin.', 'Signed in. You can go back to Hasbihal.']
    : [
        'Giriş yapılamadı. Hasbihal’a dönüp yeniden dene.',
        'Sign-in didn’t work. Go back to Hasbihal and try again.',
      ];
  return `<!doctype html><meta charset="utf-8"><title>Hasbihal</title>
<body style="font:16px system-ui;margin:20vh auto;max-width:28em;text-align:center;color:#333">
<p><strong>${tr}</strong></p><p>${en}</p></body>`;
}

export class GoogleSignIn {
  readonly #options: GoogleSignInOptions;
  #cancelCurrent: (() => void) | null = null;

  constructor(options: GoogleSignInOptions) {
    this.#options = options;
  }

  /** Stops a sign-in in progress (it resolves as `cancelled`). */
  cancel(): void {
    this.#cancelCurrent?.();
  }

  /** One sign-in. Starting another cancels the one before. */
  async run(): Promise<GoogleSignInOutcome> {
    this.cancel();
    const { client, openBrowser, loginHint } = this.#options;
    const fetchImpl = this.#options.fetch ?? globalThis.fetch;
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const state = base64url(randomBytes(16));

    let server: Server | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const callback = new Promise<
        { code: string; redirectUri: string } | { reason: 'cancelled' | 'timeout' | 'failed' }
      >((resolve) => {
        server = createServer((request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          // Only Google's redirect, for this sign-in, counts; browsers also ask for /favicon.ico.
          if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
            response.writeHead(404).end();
            return;
          }
          const code = url.searchParams.get('code');
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(page(code !== null));
          if (code) resolve({ code, redirectUri: redirectUri() });
          // `access_denied`: they chose not to continue at Google.
          else
            resolve({
              reason: url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed',
            });
        });
        this.#cancelCurrent = () => {
          resolve({ reason: 'cancelled' });
        };
        timer = setTimeout(() => {
          resolve({ reason: 'timeout' });
        }, this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      });
      const redirectUri = () =>
        `http://127.0.0.1:${String((server?.address() as AddressInfo).port)}`;
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(0, '127.0.0.1', resolve);
      });

      const authUrl = new URL(client.authUrl);
      authUrl.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // Always ask which account: a family computer may have several signed in.
        prompt: 'select_account',
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      await openBrowser(authUrl.toString());

      const answer = await callback;
      if ('reason' in answer) return { ok: false, reason: answer.reason };
      return await this.#exchange(fetchImpl, answer.code, answer.redirectUri, verifier);
    } catch {
      return { ok: false, reason: 'failed' };
    } finally {
      clearTimeout(timer);
      this.#cancelCurrent = null;
      server?.close();
    }
  }

  async #exchange(
    fetchImpl: typeof fetch,
    code: string,
    redirectUri: string,
    verifier: string,
  ): Promise<GoogleSignInOutcome> {
    const { client } = this.#options;
    const response = await fetchImpl(client.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    const idToken =
      typeof body === 'object' && body !== null && 'id_token' in body ? body.id_token : undefined;
    return response.ok && typeof idToken === 'string'
      ? { ok: true, idToken }
      : { ok: false, reason: 'failed' };
  }
}
