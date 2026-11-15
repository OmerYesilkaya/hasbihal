import { describe, expect, it } from 'vitest';
import type { Decoration } from './ast.ts';
import { decorate } from './parse.ts';

/** Decorations as readable [kind, covered text] pairs. */
const show = (source: string) =>
  decorate(source).map((d: Decoration) => [d.kind, source.slice(d.from, d.to)]);

describe('decorate', () => {
  it('marks emphasis and its markers', () => {
    expect(show('a **kalın** b')).toEqual([
      ['bold', '**kalın**'],
      ['marker', '**'],
      ['marker', '**'],
    ]);
  });

  it('reports nested ranges inside their parent', () => {
    expect(show('**x _y_**')).toEqual([
      ['bold', '**x _y_**'],
      ['marker', '**'],
      ['italic', '_y_'],
      ['marker', '_'],
      ['marker', '_'],
      ['marker', '**'],
    ]);
  });

  it('marks code, links, mentions, and escapes', () => {
    expect(show('`k` https://a.io @omer @everyone \\*')).toEqual([
      ['code', '`k`'],
      ['marker', '`'],
      ['marker', '`'],
      ['link', 'https://a.io'],
      ['mention', '@omer'],
      ['everyone', '@everyone'],
      ['marker', '\\'],
    ]);
  });

  it('maps positions through quotes and lists back to the source', () => {
    const source = 'giriş\n> **alıntı** var\n- *madde*';
    expect(show(source)).toEqual([
      ['marker', '> '],
      ['bold', '**alıntı**'],
      ['marker', '**'],
      ['marker', '**'],
      ['marker', '- '],
      ['italic', '*madde*'],
      ['marker', '*'],
      ['marker', '*'],
    ]);
  });

  it('marks fences and the code between them', () => {
    expect(show('```js\nlet a;\nlet b;\n```')).toEqual([
      ['marker', '```js'],
      ['code_block', 'let a;\nlet b;'],
      ['marker', '```'],
    ]);
  });

  it('spans lines in a multi-line paragraph', () => {
    expect(show('**iki\nsatır**')).toEqual([
      ['bold', '**iki\nsatır**'],
      ['marker', '**'],
      ['marker', '**'],
    ]);
  });
});
