import { describe, expect, it } from 'vitest';
import { USERNAME_PATTERN } from '@hasbihal/protocol';
import { usernameBase, usernameCandidates } from './usernames.ts';

describe('usernames from Google addresses', () => {
  it('uses the local part', () => {
    expect(usernameBase('ayse.yilmaz@gmail.com')).toBe('ayse.yilmaz');
    expect(usernameBase('fbetulyesilkaya7@gmail.com')).toBe('fbetulyesilkaya7');
  });

  it('drops accents and what A53 doesn’t allow', () => {
    expect(usernameBase('Şükrü-Işık+okul@example.com')).toBe('sukruisikokul');
  });

  it('fits 3–20 characters', () => {
    expect(usernameBase('a@example.com')).toBe('a00');
    expect(usernameBase('bir.cok.uzun.adres.parcasi@example.com')).toBe('bir.cok.uzun.adres.p');
  });

  it('numbers later candidates, still within 20 characters', () => {
    const candidates = usernameCandidates('bir.cok.uzun.adres.parcasi@example.com');
    const firstThree = [candidates.next().value, candidates.next().value, candidates.next().value];
    expect(firstThree).toEqual([
      'bir.cok.uzun.adres.p',
      'bir.cok.uzun.adres.2',
      'bir.cok.uzun.adres.3',
    ]);
    for (const name of firstThree) expect(name).toMatch(USERNAME_PATTERN);
  });
});
