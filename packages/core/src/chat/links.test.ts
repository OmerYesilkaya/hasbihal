import { describe, expect, it } from 'vitest';
import { extractLinks } from './links.ts';

describe('extractLinks', () => {
  it('finds links in order, once each, up to the limit', () => {
    expect(
      extractLinks(
        'Bak: https://a.example/1 ve **https://b.example** sonra https://a.example/1\n> https://c.example\n- https://d.example',
      ),
    ).toEqual(['https://a.example/1', 'https://b.example', 'https://c.example']);
  });

  it('leaves out links in spoilers and code', () => {
    expect(
      extractLinks('||https://gizli.example|| `https://kod.example` https://acik.example'),
    ).toEqual(['https://acik.example']);
  });
});
