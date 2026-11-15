import type { Block, Inline } from './ast.ts';

/**
 * The Markdown subset of DECISIONS A47 and A48, with chat semantics: every newline is a line
 * break, and a blank line starts a new paragraph. Anything outside the subset (headings, HTML,
 * masked links, underline) stays as plain text. Every search is linear in the input, and nesting
 * is capped, so a hostile 4000-character message can't stall or crash the client.
 */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), 0);
}

/** Deeper quotes or emphasis are kept as text. */
const MAX_DEPTH = 8;

// ---- blocks ----------------------------------------------------------------------------------

const FENCE_OPEN = /^```\s*([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const QUOTE = /^>[ \t]?/;
const BULLET = /^[-*][ \t]+(\S.*)$/;
const NUMBERED = /^(\d{1,9})[.)][ \t]+(\S.*)$/;

function parseBlocks(lines: string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n'), depth) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !FENCE_CLOSE.test(lines[i] ?? ''); i++)
        body.push(lines[i] ?? '');
      blocks.push({
        type: 'code_block',
        language: fence[1] ? fence[1].toLowerCase() : null,
        text: body.join('\n'),
      });
      continue;
    }

    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i] ?? ''); i++)
        quoted.push((lines[i] ?? '').replace(QUOTE, ''));
      i--;
      blocks.push({ type: 'quote', children: parseBlocks(quoted, depth + 1) });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (BULLET.test(line) || numbered) {
      flush();
      const ordered = numbered !== null;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      for (; i < lines.length; i++) {
        const item = pattern.exec(lines[i] ?? '');
        if (!item) break;
        items.push(parseInline((ordered ? item[2] : item[1]) ?? '', depth));
      }
      i--;
      blocks.push({ type: 'list', ordered, start: ordered ? Number(numbered[1]) : 1, items });
      continue;
    }

    if (line.trim() === '') flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

// ---- inline ----------------------------------------------------------------------------------

const ESCAPABLE = new Set('\\`*_~|>#@[]()-.!');
const WORD = /[\p{L}\p{N}]/u;
const URL_START = /https?:\/\/[^\s<>]+/y;
const MENTION_START = /@([a-z0-9._]{3,20})(?![a-z0-9_])/iy;
const BEFORE_MENTION = /[\p{L}\p{N}_.@]/u;

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c);

const EMPHASIS = [
  { marker: '||', type: 'spoiler' },
  { marker: '**', type: 'bold' },
  { marker: '~~', type: 'strike' },
  { marker: '*', type: 'italic' },
  { marker: '_', type: 'italic' },
] as const;

/** Length of the run of `char` starting at `i`. */
function runLength(s: string, i: number, char: string): number {
  let n = 0;
  while (s[i + n] === char) n++;
  return n;
}

/**
 * The position of the delimiter closing `marker` opened just before `from`, or -1. Code spans and
 * escapes are skipped over, and a single `*` doesn't close on half of a `**`.
 */
function findClose(s: string, from: number, marker: string): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '`') {
      const n = runLength(s, i, '`');
      const end = findCodeEnd(s, i + n, n);
      i = (end === -1 ? i + n : end + n) - 1;
      continue;
    }
    if (!s.startsWith(marker, i) || isSpace(s[i - 1])) continue;
    if (marker === '*' && (s[i + 1] === '*' || s[i - 1] === '*')) {
      i += runLength(s, i, '*') - 1; // part of a ** pair, not a lone *
      continue;
    }
    if (marker === '_' && isWord(s[i + 1])) continue; // intraword underscore
    return i;
  }
  return -1;
}

/** Start of the next run of exactly `n` backticks at or after `from`, or -1. */
function findCodeEnd(s: string, from: number, n: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] !== '`') continue;
    const run = runLength(s, i, '`');
    if (run === n) return i;
    i += run - 1;
  }
  return -1;
}

/** An http(s) URL at `i`, without trailing punctuation or an unbalanced closing parenthesis. */
function readUrl(s: string, i: number): string | undefined {
  URL_START.lastIndex = i;
  let url = URL_START.exec(s)?.[0];
  if (!url) return undefined;
  for (;;) {
    const last = url.at(-1);
    if (last !== undefined && '.,!?;:\'"'.includes(last)) url = url.slice(0, -1);
    else if (last === ')' && url.split(')').length > url.split('(').length) url = url.slice(0, -1);
    else break;
  }
  return url;
}

function parseInline(s: string, depth: number): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };

  let i = 0;
  outer: while (i < s.length) {
    const c = s[i] ?? '';

    const next = s[i + 1];
    if (c === '\\' && next !== undefined && ESCAPABLE.has(next)) {
      text += next;
      i += 2;
      continue;
    }

    if (c === '\n') {
      flush();
      out.push({ type: 'break' });
      i++;
      continue;
    }

    if (c === '`') {
      const n = runLength(s, i, '`');
      const end = findCodeEnd(s, i + n, n);
      if (end === -1) {
        text += s.slice(i, i + n);
        i += n;
        continue;
      }
      let code = s.slice(i + n, end);
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
      flush();
      out.push({ type: 'code', text: code });
      i = end + n;
      continue;
    }

    if (depth < MAX_DEPTH) {
      for (const { marker, type } of EMPHASIS) {
        if (!s.startsWith(marker, i) || isSpace(s[i + marker.length])) continue;
        if (marker === '_' && isWord(s[i - 1])) continue;
        // `**`/`*` runs longer than the marker are literal, e.g. "****" or "2 ** 8".
        if (marker === '*' && s[i + 1] === '*') continue;
        const close = findClose(s, i + marker.length + 1, marker);
        if (close === -1) continue;
        flush();
        out.push({ type, children: parseInline(s.slice(i + marker.length, close), depth + 1) });
        i = close + marker.length;
        continue outer;
      }
    }

    if (c === 'h' && !isWord(s[i - 1])) {
      const url = readUrl(s, i);
      if (url) {
        flush();
        out.push({ type: 'link', url });
        i += url.length;
        continue;
      }
    }

    if (c === '@' && !BEFORE_MENTION.test(s[i - 1] ?? ' ')) {
      MENTION_START.lastIndex = i;
      const name = MENTION_START.exec(s)?.[1]?.toLowerCase().replace(/\.+$/, '');
      if (name && name.length >= 3) {
        flush();
        out.push(name === 'everyone' ? { type: 'everyone' } : { type: 'mention', username: name });
        i += 1 + name.length;
        continue;
      }
    }

    text += c;
    i++;
  }
  flush();
  return out;
}

// ---- plain text ------------------------------------------------------------------------------

/** For notifications and previews: the words without markup. Spoilers stay hidden by default. */
export function toPlainText(blocks: Block[], options: { revealSpoilers?: boolean } = {}): string {
  const inline = (nodes: Inline[]): string =>
    nodes
      .map((node) => {
        switch (node.type) {
          case 'text':
          case 'code':
            return node.text;
          case 'bold':
          case 'italic':
          case 'strike':
            return inline(node.children);
          case 'spoiler':
            return options.revealSpoilers ? inline(node.children) : '▒▒▒';
          case 'link':
            return node.url;
          case 'mention':
            return `@${node.username}`;
          case 'everyone':
            return '@everyone';
          case 'break':
            return '\n';
        }
      })
      .join('');
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
          return inline(block.children);
        case 'code_block':
          return block.text;
        case 'quote':
          return toPlainText(block.children, options);
        case 'list':
          return block.items.map(inline).join('\n');
      }
    })
    .join('\n');
}
