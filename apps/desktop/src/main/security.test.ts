import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
const { isTrustedOrigin } = await import('./security.ts');

describe('isTrustedOrigin', () => {
  it('trusts the app\'s own pages, whose URL.origin is "null"', () => {
    expect(isTrustedOrigin('app://hasbihal/index.html', undefined)).toBe(true);
    expect(isTrustedOrigin('app://hasbihal', undefined)).toBe(true);
  });

  it('trusts the dev server only in development', () => {
    expect(isTrustedOrigin('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isTrustedOrigin('http://localhost:5173/', undefined)).toBe(false);
  });

  it('trusts nothing else', () => {
    expect(isTrustedOrigin('app://other/index.html', undefined)).toBe(false);
    expect(isTrustedOrigin('https://hasbihal.example/', undefined)).toBe(false);
    expect(isTrustedOrigin('not a url', undefined)).toBe(false);
  });
});
