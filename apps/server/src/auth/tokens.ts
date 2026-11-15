import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { Id } from '@hasbihal/protocol';

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

/** A random 256-bit token, URL-safe. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored as SHA-256 hashes: they are random and long, so a slow hash adds nothing. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SigningKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** A new Ed25519 private key, PEM-encoded, for `AUTH_SIGNING_KEY`. */
export function generateSigningKeyPem(): string {
  return generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
}

export function signingKeysFromPem(pem: string): SigningKeys {
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('AUTH_SIGNING_KEY must be an Ed25519 private key');
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

/** A 15-minute EdDSA JWT (ARCHITECTURE §9). */
export async function signAccessToken(
  keys: SigningKeys,
  claims: AccessClaims,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const token = await new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(claims.userId)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(keys.privateKey);
  return { token, expiresAt };
}

/** The claims of a valid, unexpired access token, or undefined. */
export async function verifyAccessToken(
  keys: SigningKeys,
  token: string,
): Promise<AccessClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, { algorithms: ['EdDSA'] });
    const userId = Id.safeParse(payload.sub);
    const sessionId = Id.safeParse(payload.sid);
    return userId.success && sessionId.success
      ? { userId: userId.data, sessionId: sessionId.data }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Refresh tokens are `<sessionId>.<secret>`; only the secret's hash is stored. */
export function makeRefreshToken(sessionId: string): { token: string; hash: Buffer } {
  const secret = randomToken();
  return { token: `${sessionId}.${secret}`, hash: hashToken(secret) };
}

export function parseRefreshToken(token: string): { sessionId: string; hash: Buffer } | undefined {
  const dot = token.indexOf('.');
  const sessionId = Id.safeParse(token.slice(0, dot));
  const secret = token.slice(dot + 1);
  if (dot < 0 || !sessionId.success || !secret) return undefined;
  return { sessionId: sessionId.data, hash: hashToken(secret) };
}
