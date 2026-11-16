import { describe, expect, it } from 'vitest';
import { decodeHtml, parsePageMeta } from './parse.ts';

describe('parsePageMeta', () => {
  it('reads Open Graph, with entities decoded and the picture made absolute', () => {
    const html = `<!doctype html><html><head>
      <title>Yedek başlık</title>
      <meta property="og:title" content="Kuru fasulye &amp; pilav">
      <meta property='og:description' content="Annemin tarifi&#44; adım adım.">
      <meta property="og:site_name" content="Lezzet">
      <meta property="og:image" content="/resimler/kapak.jpg">
    </head><body><meta property="og:title" content="Gövdede, sayılmaz"></body></html>`;
    expect(parsePageMeta(html, 'https://tarif.example/yemek/1')).toEqual({
      title: 'Kuru fasulye & pilav',
      description: 'Annemin tarifi, adım adım.',
      siteName: 'Lezzet',
      imageUrl: 'https://tarif.example/resimler/kapak.jpg',
    });
  });

  it('falls back to the title tag and description, and ignores non-web pictures', () => {
    const html = `<head><title>  Haberler
      | Gazete </title><meta name="description" content="Günün özeti">
      <meta property="og:image" content="javascript:alert(1)"></head>`;
    expect(parsePageMeta(html, 'https://gazete.example/')).toEqual({
      title: 'Haberler | Gazete',
      description: 'Günün özeti',
      siteName: null,
      imageUrl: null,
    });
  });

  it('shortens very long text', () => {
    const html = `<head><meta property="og:title" content="${'a'.repeat(500)}"></head>`;
    expect(parsePageMeta(html, 'https://x.example/').title).toHaveLength(200);
  });
});

describe('decodeHtml', () => {
  it('reads older Turkish pages in windows-1254', () => {
    // "Şişli" in windows-1254: Ş = 0xDE, ş = 0xFE.
    const body = Buffer.concat([
      Buffer.from('<head><meta charset="windows-1254"><title>'),
      Buffer.from([0xde, 0x69, 0xfe, 0x6c, 0x69]),
      Buffer.from('</title></head>'),
    ]);
    expect(parsePageMeta(decodeHtml('text/html', body), 'https://x.example/').title).toBe('Şişli');
    // The header wins over the page.
    expect(decodeHtml('text/html; charset=utf-8', Buffer.from('çay'))).toBe('çay');
  });
});
