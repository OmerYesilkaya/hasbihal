import { describe, expect, it } from 'vitest';
import { deepLinkFromArgv, parseDeepLink, tokenFromInput } from './deep-link.ts';

const TOKEN = '7tjSo3JS3YcxL9Pjrr5aU5u-eoCfKmzECBYBzwz1cls';

describe('parseDeepLink', () => {
  it('reads invite and recovery links', () => {
    expect(parseDeepLink(`hasbihal://invite/${TOKEN}`)).toEqual({ kind: 'invite', token: TOKEN });
    expect(parseDeepLink(`hasbihal://recover/${TOKEN}/`)).toEqual({
      kind: 'recover',
      token: TOKEN,
    });
    expect(parseDeepLink(`  hasbihal://invite/${TOKEN}\n`)).toEqual({
      kind: 'invite',
      token: TOKEN,
    });
  });

  it('rejects anything else', () => {
    for (const bad of [
      `https://invite/${TOKEN}`,
      `hasbihal://admin/${TOKEN}`,
      `hasbihal://invite/${TOKEN}/extra`,
      `hasbihal://invite/${TOKEN}?next=evil`,
      `hasbihal://invite/${TOKEN}#x`,
      'hasbihal://invite/short',
      'hasbihal://invite/has%20space-and-more-characters',
      'not a url',
    ]) {
      expect(parseDeepLink(bad), bad).toBeUndefined();
    }
  });
});

describe('tokenFromInput', () => {
  it('accepts a pasted link or a bare token for the right form', () => {
    expect(tokenFromInput(`hasbihal://invite/${TOKEN}`, 'invite')).toBe(TOKEN);
    expect(tokenFromInput(` ${TOKEN} `, 'invite')).toBe(TOKEN);
    expect(tokenFromInput(`hasbihal://recover/${TOKEN}`, 'invite')).toBeUndefined();
    expect(tokenFromInput('nope', 'recover')).toBeUndefined();
  });
});

describe('deepLinkFromArgv', () => {
  it('finds the link Windows passes on the command line', () => {
    const argv = [
      'C:\\Hasbihal\\Hasbihal.exe',
      '--allow-file-access-from-files',
      `hasbihal://invite/${TOKEN}`,
    ];
    expect(deepLinkFromArgv(argv)).toEqual({ kind: 'invite', token: TOKEN });
    expect(deepLinkFromArgv(['Hasbihal.exe'])).toBeUndefined();
  });
});
