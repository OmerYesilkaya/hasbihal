import argon2 from 'argon2';
import { dictionary } from '@zxcvbn-ts/language-common';

/** OWASP's recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const COMMON_PASSWORDS = new Set([
  ...dictionary['passwords-common'].map((p) => p.toLowerCase()),
  'hasbihal123',
  'hasbihal1234',
]);

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // a malformed hash is a failed check, not a crash
  }
}

/** True when a stored hash uses older parameters and should be replaced at the next sign-in. */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends as long as a real check, for sign-ins with an unknown username, so response times don't
 * reveal which usernames exist.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy password for timing');
  await verifyPassword(await dummyHash, password);
  return false;
}

/**
 * Why a new password is unacceptable, or undefined. Length is already checked by the schema;
 * this rejects passwords from the common-password list and ones that contain the username.
 */
export function passwordProblem(password: string, username: string): string | undefined {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'This password is too common.';
  if (lower.includes(username.toLowerCase())) return 'The password must not contain the username.';
  return undefined;
}
