import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../errors.ts';

/** Google's sign-in (OpenID Connect), as Google documents it for verifying ID tokens. */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Who an ID token says signed in, after its signature and claims checked out. */
export interface GoogleIdentity {
  /** Google's permanent account id. */
  sub: string;
  /** Lowercase, and verified by Google. */
  email: string;
  /** The account's name, or the address's local part when it has none. */
  name: string;
  /** The profile photo's address, if the account has one. */
  picture: string | null;
}

export interface GoogleVerifier {
  /** The identity in a valid ID token for this app, or undefined for any other token. */
  verify(idToken: string): Promise<GoogleIdentity | undefined>;
}

export interface GoogleVerifierOptions {
  /** The app's OAuth client id: the token must be issued to it (`aud`). */
  clientId: string;
  issuers: string[];
  /** Google's signing keys; tests pass their own. */
  keys: JWTVerifyGetKey;
}

/** Errors that mean "Google's keys couldn't be fetched", not "this token is bad". */
const unreachable = (error: unknown) =>
  error instanceof errors.JWKSTimeout ||
  !(error instanceof errors.JOSEError) ||
  error.code === 'ERR_JOSE_GENERIC';

export function googleVerifier({ clientId, issuers, keys }: GoogleVerifierOptions): GoogleVerifier {
  return {
    async verify(idToken) {
      let payload;
      try {
        ({ payload } = await jwtVerify(idToken, keys, {
          issuer: issuers,
          audience: clientId,
          algorithms: ['RS256'],
        }));
      } catch (error) {
        if (unreachable(error))
          throw new AppError(503, 'unavailable', 'Google sign-in is unavailable right now.');
        return undefined;
      }
      const { sub, email, email_verified: verified, name, picture } = payload;
      if (typeof sub !== 'string' || !sub || typeof email !== 'string' || verified !== true)
        return undefined;
      const address = email.toLowerCase();
      return {
        sub,
        email: address,
        name: typeof name === 'string' && name.trim() ? name : (address.split('@')[0] ?? address),
        // Fetched later through the safe fetcher, like link previews: public addresses only.
        picture: typeof picture === 'string' && /^https?:\/\//.test(picture) ? picture : null,
      };
    },
  };
}

/** The verifier for Google itself (or, outside production, a stand-in at `jwksUrl`). */
export function remoteGoogleVerifier(options: {
  clientId: string;
  issuers: string[];
  jwksUrl: string;
}): GoogleVerifier {
  return googleVerifier({ ...options, keys: createRemoteJWKSet(new URL(options.jwksUrl)) });
}
