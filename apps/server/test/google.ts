// A stand-in for Google's sign-in in the integration tests: it signs ID tokens with its own key,
// and the app checks them with that key instead of fetching Google's.
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { googleVerifier, type GoogleVerifier } from '../src/auth/google.ts';

export const TEST_GOOGLE_CLIENT_ID = 'hasbihal-test.apps.googleusercontent.com';
const ISSUER = 'https://accounts.google.com';

export interface GoogleAccount {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface TokenOptions {
  /** Defaults to true; Google marks Gmail addresses verified. */
  emailVerified?: boolean;
  audience?: string;
  issuer?: string;
  /** Seconds from now; negative for an expired token. */
  expiresIn?: number;
  /** Signs with another key, as a forger would. */
  forged?: boolean;
}

export interface FakeGoogle {
  verifier: GoogleVerifier;
  /** A new account with a unique address and id. */
  account(name?: string): GoogleAccount;
  idToken(account: GoogleAccount, options?: TokenOptions): Promise<string>;
}

const keyPair = () => generateKeyPair('RS256', { extractable: true });

export async function fakeGoogle(): Promise<FakeGoogle> {
  const { privateKey, publicKey } = await keyPair();
  const forger = (await keyPair()).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
  let counter = 0;

  const sign = (key: CryptoKey, account: GoogleAccount, options: TokenOptions) =>
    new SignJWT({
      email: account.email,
      email_verified: options.emailVerified ?? true,
      ...(account.name ? { name: account.name } : {}),
      ...(account.picture ? { picture: account.picture } : {}),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? TEST_GOOGLE_CLIENT_ID)
      .setSubject(account.sub)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (options.expiresIn ?? 3600))
      .sign(key);

  return {
    verifier: googleVerifier({
      clientId: TEST_GOOGLE_CLIENT_ID,
      issuers: [ISSUER, 'accounts.google.com'],
      keys: createLocalJWKSet({ keys: [jwk] }),
    }),
    account(name) {
      const n = String(++counter);
      return {
        sub: `1${randomUUID().replaceAll('-', '').replace(/\D/g, '').slice(0, 20)}${n}`,
        email: `uye.${n}.${randomUUID().slice(0, 8)}@gmail.com`,
        name: name ?? `Üye ${n}`,
      };
    },
    idToken: (account, options = {}) =>
      sign(options.forged ? forger : privateKey, account, options),
  };
}
