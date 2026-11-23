import { USERNAME_PATTERN } from '@hasbihal/protocol';

const MAX = 20;
const MIN = 3;

/**
 * A new member's @mention handle (A53), from their Google address: `ayse.yilmaz@gmail.com`
 * becomes `ayse.yilmaz`. Accents are dropped, anything else outside A53 removed, and the result
 * cut to 20 characters (or padded to 3).
 */
export function usernameBase(email: string): string {
  const local = email.slice(0, Math.max(0, email.indexOf('@'))) || email;
  const cleaned = local
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, MAX);
  return cleaned.padEnd(MIN, '0');
}

/** The base, then `base2`, `base3`, … cut to fit: try each until one is free. */
export function* usernameCandidates(email: string): Generator<string, never> {
  const base = usernameBase(email);
  yield base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, MAX - suffix.length) + suffix;
    if (USERNAME_PATTERN.test(candidate)) yield candidate;
  }
}
