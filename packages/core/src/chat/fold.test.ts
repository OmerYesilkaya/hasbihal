import { describe, expect, it } from 'vitest';
import { foldTurkish } from './fold.ts';

describe('foldTurkish', () => {
  it('matches across case, Turkish letters, and accents', () => {
    expect(foldTurkish('Ömer')).toBe('omer');
    expect(foldTurkish('IŞIK')).toBe('isik');
    expect(foldTurkish('İstanbul')).toBe('istanbul');
    expect(foldTurkish('Çay ve Şeker, Ğ ü')).toBe('cay ve seker, g u');
  });
});
