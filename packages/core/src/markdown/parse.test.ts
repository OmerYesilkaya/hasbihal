import { describe, expect, it } from 'vitest';
import type { Block, Inline } from './ast.ts';
import { decorate, parseMarkdown, toPlainText } from './parse.ts';

const text = (t: string): Inline => ({ type: 'text', text: t });
const p = (...children: Inline[]): Block => ({ type: 'paragraph', children });
/** The inlines of a single-paragraph message. */
const inline = (source: string): Inline[] => {
  const blocks = parseMarkdown(source);
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  if (block?.type !== 'paragraph') throw new Error(`not a paragraph: ${JSON.stringify(block)}`);
  return block.children;
};

describe('paragraphs and line breaks', () => {
  it('parses plain text, and nothing for empty input', () => {
    expect(parseMarkdown('Merhaba, nasılsın?')).toEqual([p(text('Merhaba, nasılsın?'))]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });

  it('turns every newline into a break, and blank lines into paragraphs', () => {
    expect(parseMarkdown('bir\niki\n\nüç')).toEqual([
      p(text('bir'), { type: 'break' }, text('iki')),
      p(text('üç')),
    ]);
    expect(parseMarkdown('a\r\nb')).toEqual([p(text('a'), { type: 'break' }, text('b'))]);
  });

  it('keeps unsupported syntax as text: headings, underline, HTML, masked links (A47, A48)', () => {
    expect(inline('# Başlık')).toEqual([text('# Başlık')]);
    expect(inline('<b>kalın</b> <script>alert(1)</script>')).toEqual([
      text('<b>kalın</b> <script>alert(1)</script>'),
    ]);
    expect(inline('[tıkla](https://evil.example)')).toEqual([
      text('[tıkla]('),
      { type: 'link', url: 'https://evil.example' },
      text(')'),
    ]);
  });
});

describe('emphasis', () => {
  it('parses bold, italic, strikethrough, and spoilers', () => {
    expect(inline('**kalın** *eğik* _eğik_ ~~çizik~~ ||sürpriz||')).toEqual([
      { type: 'bold', children: [text('kalın')] },
      text(' '),
      { type: 'italic', children: [text('eğik')] },
      text(' '),
      { type: 'italic', children: [text('eğik')] },
      text(' '),
      { type: 'strike', children: [text('çizik')] },
      text(' '),
      { type: 'spoiler', children: [text('sürpriz')] },
    ]);
  });

  it('nests', () => {
    expect(inline('**çok _önemli_ şey**')).toEqual([
      {
        type: 'bold',
        children: [text('çok '), { type: 'italic', children: [text('önemli')] }, text(' şey')],
      },
    ]);
    expect(inline('*a **b** c*')).toEqual([
      {
        type: 'italic',
        children: [text('a '), { type: 'bold', children: [text('b')] }, text(' c')],
      },
    ]);
    expect(inline('||**gizli** son||')).toEqual([
      { type: 'spoiler', children: [{ type: 'bold', children: [text('gizli')] }, text(' son')] },
    ]);
  });

  it('leaves unmatched or spaced delimiters alone', () => {
    expect(inline('**yarım')).toEqual([text('**yarım')]);
    expect(inline('a * b * c')).toEqual([text('a * b * c')]);
    expect(inline('2 ** 8 = 256')).toEqual([text('2 ** 8 = 256')]);
    expect(inline('****')).toEqual([text('****')]);
  });

  it("doesn't italicize inside words with underscores", () => {
    expect(inline('dosya_adi_burada ve snake_case')).toEqual([
      text('dosya_adi_burada ve snake_case'),
    ]);
  });

  it('honours backslash escapes', () => {
    expect(inline('\\*eğik değil\\* ve \\|\\|açık\\|\\|')).toEqual([
      text('*eğik değil* ve ||açık||'),
    ]);
    expect(inline('C:\\Users\\omer')).toEqual([text('C:\\Users\\omer')]);
  });
});

describe('code', () => {
  it('parses inline code without formatting inside', () => {
    expect(inline('çalıştır: `npm **i**` tamam')).toEqual([
      text('çalıştır: '),
      { type: 'code', text: 'npm **i**' },
      text(' tamam'),
    ]);
    expect(inline('``kod ` içinde``')).toEqual([{ type: 'code', text: 'kod ` içinde' }]);
    expect(inline('tek ` işaret')).toEqual([text('tek ` işaret')]);
  });

  it('parses fenced code blocks with a language, untouched inside', () => {
    expect(parseMarkdown('önce\n```TS\nconst a = **1**;\n\n@everyone\n```\nsonra')).toEqual([
      p(text('önce')),
      { type: 'code_block', language: 'ts', text: 'const a = **1**;\n\n@everyone' },
      p(text('sonra')),
    ]);
  });

  it('runs an unclosed fence to the end', () => {
    expect(parseMarkdown('```\nyarım kalan\nkod')).toEqual([
      { type: 'code_block', language: null, text: 'yarım kalan\nkod' },
    ]);
  });
});

describe('quotes and lists', () => {
  it('groups quoted lines, with formatting inside', () => {
    expect(parseMarkdown('> **dedi ki**\n> tamam\nben de')).toEqual([
      {
        type: 'quote',
        children: [
          p({ type: 'bold', children: [text('dedi ki')] }, { type: 'break' }, text('tamam')),
        ],
      },
      p(text('ben de')),
    ]);
  });

  it('parses bulleted and numbered lists', () => {
    expect(parseMarkdown('- süt\n* *ekmek*\n- çay')).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [[text('süt')], [{ type: 'italic', children: [text('ekmek')] }], [text('çay')]],
      },
    ]);
    expect(parseMarkdown('3. üç\n4. dört')).toEqual([
      { type: 'list', ordered: true, start: 3, items: [[text('üç')], [text('dört')]] },
    ]);
  });

  it("doesn't mistake emphasis at the start of a line for a list", () => {
    expect(parseMarkdown('*önemli* bir şey')).toEqual([
      p({ type: 'italic', children: [text('önemli')] }, text(' bir şey')),
    ]);
  });
});

describe('links and mentions', () => {
  it('auto-links http(s) URLs, leaving trailing punctuation out', () => {
    expect(inline('bak: https://example.com/a?b=1.')).toEqual([
      text('bak: '),
      { type: 'link', url: 'https://example.com/a?b=1' },
      text('.'),
    ]);
    expect(inline('(http://x.org/wiki/Elma_(meyve))')).toEqual([
      text('('),
      { type: 'link', url: 'http://x.org/wiki/Elma_(meyve)' },
      text(')'),
    ]);
  });

  it('never links other schemes', () => {
    expect(inline('javascript:alert(1) file:///etc/passwd')).toEqual([
      text('javascript:alert(1) file:///etc/passwd'),
    ]);
  });

  it('finds mentions and @everyone, but not in emails or code', () => {
    expect(inline('@omer ve @everyone, mail: a@b.com, `@ayse`')).toEqual([
      { type: 'mention', username: 'omer' },
      text(' ve '),
      { type: 'everyone' },
      text(', mail: a@b.com, '),
      { type: 'code', text: '@ayse' },
    ]);
  });
});

describe('robustness', () => {
  it('stays fast on pathological input', () => {
    for (const nasty of [
      '*'.repeat(4000),
      '**a'.repeat(1333),
      '**a '.repeat(1000),
      '||a '.repeat(1000),
      '||'.repeat(2000),
      '_a'.repeat(2000),
      '`'.repeat(4000),
      '`a'.repeat(2000),
      '> '.repeat(2000),
      'https://a.b '.repeat(333),
      '@aaa '.repeat(800),
    ]) {
      const start = performance.now();
      parseMarkdown(nasty);
      decorate(nasty); // the composer runs this on every keystroke
      expect(performance.now() - start, nasty.slice(0, 6)).toBeLessThan(200);
    }
  });

  it('limits nesting depth instead of recursing forever', () => {
    expect(() => parseMarkdown('>'.repeat(2000) + ' derin')).not.toThrow();
    expect(() => parseMarkdown('**_'.repeat(500) + 'x' + '_**'.repeat(500))).not.toThrow();
  });
});

describe('toPlainText', () => {
  it('drops markup, and hides spoilers unless asked', () => {
    const blocks = parseMarkdown('**Akşam** ||sürpriz|| var @omer\n> alıntı\n```\nkod\n```');
    expect(toPlainText(blocks)).toBe('Akşam ▒▒▒ var @omer\nalıntı\nkod');
    expect(toPlainText(blocks, { revealSpoilers: true })).toBe(
      'Akşam sürpriz var @omer\nalıntı\nkod',
    );
  });
});
