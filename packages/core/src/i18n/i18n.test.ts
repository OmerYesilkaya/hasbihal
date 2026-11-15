import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { createTranslator, resolveLocale } from './index.ts';
import { tr } from './tr.ts';

describe('catalogs', () => {
  it('English has exactly the Turkish keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
  });
});

describe('resolveLocale', () => {
  it('matches by language subtag', () => {
    expect(resolveLocale(['en-GB', 'tr-TR'])).toBe('en');
    expect(resolveLocale(['tr-TR'])).toBe('tr');
  });

  it('falls back to Turkish', () => {
    expect(resolveLocale(['de-DE', 'fr'])).toBe('tr');
    expect(resolveLocale([])).toBe('tr');
  });
});

describe('createTranslator', () => {
  it('formats plurals per locale', () => {
    const t = createTranslator('en');
    expect(t('members.count', { count: 1 })).toBe('1 member');
    expect(t('members.count', { count: 13 })).toBe('13 members');
    expect(createTranslator('tr')('members.count', { count: 13 })).toBe('13 üye');
  });

  it('interpolates values without Turkish suffixes', () => {
    expect(createTranslator('tr')('composer.placeholder', { room: 'Mutfak' })).toBe(
      'Mesaj yaz · Mutfak',
    );
  });
});
