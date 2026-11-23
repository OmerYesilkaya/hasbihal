import { ApiError, AuthTokens, GoogleSignInResult, User } from '@hasbihal/protocol';
import type { z } from 'zod';
import type { AuthError, AuthResult, GoogleOutcome } from '../shared/app-info.ts';
import type { GoogleSignInOutcome } from './google-sign-in.ts';

/** Where the refresh token is kept between launches (encrypted on disk, see token-store.ts). */
export interface TokenStore {
  load(): Promise<string | null>;
  save(refreshToken: string | null): Promise<void>;
}

/** Who Google says this is: the browser half of the sign-in (`GoogleSignIn`). */
export interface GoogleIdentityProvider {
  run(): Promise<GoogleSignInOutcome>;
  cancel(): void;
}

export interface AuthSessionOptions {
  serverUrl: string;
  /** Undefined in builds without a Google client (development without one set up). */
  google: GoogleIdentityProvider | undefined;
  /** Shown in the user's sessions list. */
  deviceName: string;
  store: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Refresh this long before the access token expires, so requests never race its expiry. */
const REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const ok = <T>(value: T): AuthResult<T> => ({ ok: true, value });
const fail = <T>(error: AuthError): AuthResult<T> => ({ ok: false, error });
const unreachable: AuthError = { code: 'unavailable', message: 'The server cannot be reached.' };

/**
 * The signed-in session, owned by the main process. Only one refresh runs at a time: the server
 * treats a second use of the same refresh token as theft (ARCHITECTURE §9).
 */
export class AuthSession {
  readonly #options: Required<AuthSessionOptions>;
  #refreshToken: string | null = null;
  /** The stored refresh token is read once, asynchronously; every entry point waits for it. */
  readonly #loaded: Promise<void>;
  #access: { token: string; expiresAt: number } | null = null;
  #refreshing: Promise<AuthResult<string>> | null = null;
  /**
   * The ID token of a Google account that isn't on the list, kept for asking an admin to let it
   * in. It never leaves the main process, and Google's tokens expire within the hour.
   */
  #notAllowedToken: string | null = null;
  readonly #endedListeners = new Set<() => void>();

  constructor(options: AuthSessionOptions) {
    this.#options = { fetch: globalThis.fetch, now: Date.now, ...options };
    this.#loaded = options.store.load().then(
      (token) => {
        this.#refreshToken = token;
      },
      () => undefined, // unreadable store: start signed out
    );
  }

  onSessionEnded(listener: () => void): () => void {
    this.#endedListeners.add(listener);
    return () => this.#endedListeners.delete(listener);
  }

  async restore(): Promise<AuthResult<User | null>> {
    await this.#loaded;
    if (!this.#refreshToken) return ok(null);
    const token = await this.accessToken();
    if (!token.ok) return token.error.code === 'unauthorized' ? ok(null) : fail(token.error);
    const me = await this.#request('GET', '/me', User, undefined, token.value);
    if (!me.ok && me.error.code === 'unauthorized') {
      await this.#end(false);
      return ok(null);
    }
    return me;
  }

  /**
   * Asks Google who this is (in the browser), then the server to sign them in. Someone not on the
   * list is told so, and may then `requestAccess`.
   */
  async signInWithGoogle(): Promise<AuthResult<GoogleOutcome>> {
    const { google } = this.#options;
    if (!google) return fail({ code: 'unavailable', message: 'Google sign-in is not set up.' });
    this.#notAllowedToken = null;
    const identity = await google.run();
    if (!identity.ok) {
      return identity.reason === 'failed'
        ? fail({ code: 'unavailable', message: 'Google sign-in failed.' })
        : ok({ kind: 'cancelled' });
    }
    const result = await this.#request('POST', '/auth/google', GoogleSignInResult, {
      idToken: identity.idToken,
      deviceName: this.#options.deviceName,
    });
    if (!result.ok) return result;
    if (result.value.status === 'not_allowed') {
      this.#notAllowedToken = identity.idToken;
      const { email, requested } = result.value;
      return ok({ kind: 'notAllowed', email, requested });
    }
    await this.#setTokens(result.value.tokens);
    return ok({ kind: 'signedIn', user: result.value.user });
  }

  cancelGoogleSignIn(): void {
    this.#options.google?.cancel();
  }

  /** "Let me in", for the Google account that just wasn't on the list. */
  async requestAccess(): Promise<AuthResult<null>> {
    const idToken = this.#notAllowedToken;
    if (!idToken) return fail({ code: 'unauthorized', message: 'Sign in with Google first.' });
    const result = await this.#request('POST', '/auth/access-requests', null, { idToken });
    return result.ok ? ok(null) : result;
  }

  /**
   * A valid access token, refreshing first when it is missing or about to expire, or when
   * `refresh` is set because the server rejected the current one.
   */
  async accessToken(refresh = false): Promise<AuthResult<string>> {
    await this.#loaded;
    const access = this.#access;
    if (!refresh && access && access.expiresAt - this.#options.now() > REFRESH_MARGIN_MS) {
      return ok(access.token);
    }
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async signOut(): Promise<void> {
    await this.#loaded;
    // A live access token is needed to tell the server; refresh first if it has expired.
    const access = this.#refreshToken ? await this.accessToken() : null;
    await this.#end(false);
    // Best effort: the local session is gone either way. When offline, the server-side session
    // stays until it expires unused (180 days) or is revoked from the sessions list.
    if (access?.ok) await this.#request('POST', '/auth/sign-out', null, {}, access.value);
  }

  async #refresh(): Promise<AuthResult<string>> {
    const refreshToken = this.#refreshToken;
    if (!refreshToken) return fail({ code: 'unauthorized', message: 'Not signed in.' });
    const result = await this.#request('POST', '/auth/refresh', AuthTokens, { refreshToken });
    if (!result.ok) {
      // Only the server saying "no" ends the session; being offline keeps it for later.
      if (result.error.code === 'unauthorized') await this.#end(true);
      return result;
    }
    await this.#setTokens(result.value);
    return ok(result.value.accessToken);
  }

  async #setTokens(tokens: AuthTokens): Promise<void> {
    this.#refreshToken = tokens.refreshToken;
    this.#access = {
      token: tokens.accessToken,
      expiresAt: Date.parse(tokens.accessTokenExpiresAt),
    };
    await this.#persist(tokens.refreshToken);
  }

  async #end(notify: boolean): Promise<void> {
    const hadSession = this.#refreshToken !== null;
    this.#refreshToken = null;
    this.#access = null;
    await this.#persist(null);
    if (notify && hadSession) for (const listener of this.#endedListeners) listener();
  }

  /** A failed write keeps the session in memory: signed in now, asked again after a restart. */
  async #persist(refreshToken: string | null): Promise<void> {
    try {
      await this.#options.store.save(refreshToken);
    } catch {
      // nothing better to do; the in-memory session still works
    }
  }

  async #request<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S | null,
    body?: object,
    accessToken?: string,
  ): Promise<AuthResult<z.infer<S>>> {
    let response: Response;
    try {
      response = await this.#options.fetch(new URL(path, this.#options.serverUrl), {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return fail(unreachable);
    }
    const json: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ApiError.safeParse(json);
      if (parsed.success) return fail(parsed.data.error);
      return fail(
        response.status >= 500
          ? unreachable
          : { code: 'internal', message: `HTTP ${String(response.status)}` },
      );
    }
    if (!schema) return ok(null as z.infer<S>);
    const parsed = schema.safeParse(json);
    return parsed.success
      ? ok(parsed.data)
      : fail({ code: 'internal', message: 'Unexpected server response.' });
  }
}
