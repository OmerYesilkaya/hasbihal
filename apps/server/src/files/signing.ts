import { createHmac, hkdfSync, timingSafeEqual, type KeyObject } from 'node:crypto';

export type FileVariant = 'original' | 'thumbnail';

/** How long a signed file address works. The client asks again before then. */
export const FILE_URL_TTL_MS = 6 * 60 * 60 * 1000;

export interface FileSignature {
  /** The member it was signed for (ARCHITECTURE §7: an HMAC over file, user, and expiry). */
  userId: string;
  /** Unix seconds. */
  expires: number;
  signature: string;
}

/**
 * Signed file addresses (ARCHITECTURE §7): `<img>` and `<video>` load files without the access
 * token, which must never end up in a URL. The key is derived from the token-signing key, so
 * addresses survive restarts and need no extra secret to configure.
 */
export class FileUrlSigner {
  readonly #key: Buffer;

  constructor(signingKey: KeyObject) {
    const material = signingKey.export({ format: 'der', type: 'pkcs8' });
    this.#key = Buffer.from(hkdfSync('sha256', material, '', 'hasbihal file urls', 32));
  }

  sign(fileId: string, variant: FileVariant, userId: string, expires: number): FileSignature {
    return { userId, expires, signature: this.#mac(fileId, variant, userId, expires) };
  }

  /** Whether the signature is ours and still valid at `now` (ms). */
  verify(fileId: string, variant: FileVariant, given: FileSignature, now = Date.now()): boolean {
    if (!Number.isInteger(given.expires) || given.expires * 1000 < now) return false;
    const expected = Buffer.from(this.#mac(fileId, variant, given.userId, given.expires));
    const actual = Buffer.from(given.signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  #mac(fileId: string, variant: FileVariant, userId: string, expires: number): string {
    return createHmac('sha256', this.#key)
      .update(`${fileId}\n${variant}\n${userId}\n${String(expires)}`)
      .digest('base64url');
  }
}
