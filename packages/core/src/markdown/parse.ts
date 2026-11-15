import type { Block, Decoration, DecorationKind, Inline } from './ast.ts';

/**
 * The Markdown subset of DECISIONS A47 and A48, with chat semantics: every newline is a line
 * break, and a blank line starts a new paragraph. Anything outside the subset (headings, HTML,
 * masked links, underline) stays as plain text. Every search is linear in the input, and nesting
 * is capped, so a hostile 4000-character message can't stall or crash the client.
 */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(toLines(source), 0, null);
}

/**
 * The same parse, as source ranges to style, for the composer's live formatting (A47): it shows
 * exactly what the message will look like, markers included. Ranges are offsets into `source`
 * (with any `\r\n` counted as `\n`), sorted by start; they nest but never cross.
 */
export function decorate(source: string): Decoration[] {
  const sink: Decoration[] = [];
  parseBlocks(toLines(source), 0, sink);
  return sink.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** Deeper quotes or emphasis are kept as text. */
const MAX_DEPTH = 8;

/** A line of content, with the source offset of its first character. */
interface Line {
  text: string;
  at: number;
}

function toLines(source: string): Line[] {
  const lines: Line[] = [];
  let at = 0;
  for (const text of source.replace(/\r\n?/g, '\n').split('\n')) {
    lines.push({ text, at });
    at += text.length + 1;
  }
  return lines;
}

const mark = (sink: Decoration[] | null, kind: DecorationKind, from: number, to: number) => {
  if (sink && to > from) sink.push({ kind, from, to });
};

// ---- blocks ----------------------------------------------------------------------------------

const FENCE_OPEN = /^```\s*([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const QUOTE = /^>[ \t]?/;
const BULLET = /^([-*][ \t]+)(\S.*)$/;
const NUMBERED = /^((\d{1,9})[.)][ \t]+)(\S.*)$/;

function parseBlocks(lines: Line[], depth: number, sink: Decoration[] | null): Block[] {
  const blocks: Block[] = [];
  let paragraph: Line[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: 'paragraph', children: parseText(paragraph, depth, sink) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? { text: '', at: 0 };

    const fence = FENCE_OPEN.exec(line.text);
    if (fence) {
      flush();
      mark(sink, 'marker', line.at, line.at + line.text.length);
      const body: Line[] = [];
      for (i++; i < lines.length && !FENCE_CLOSE.test(lines[i]?.text ?? ''); i++) {
        const bodyLine = lines[i];
        if (bodyLine) body.push(bodyLine);
      }
      const closing = lines[i];
      const first = body[0];
      const last = body.at(-1);
      if (first && last) mark(sink, 'code_block', first.at, last.at + last.text.length);
      if (closing) mark(sink, 'marker', closing.at, closing.at + closing.text.length);
      blocks.push({
        type: 'code_block',
        language: fence[1] ? fence[1].toLowerCase() : null,
        text: body.map((l) => l.text).join('\n'),
      });
      continue;
    }

    if (QUOTE.test(line.text) && depth < MAX_DEPTH) {
      flush();
      const quoted: Line[] = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        const prefix = l ? QUOTE.exec(l.text)?.[0] : undefined;
        if (!l || prefix === undefined) break;
        mark(sink, 'marker', l.at, l.at + prefix.length);
        quoted.push({ text: l.text.slice(prefix.length), at: l.at + prefix.length });
      }
      i--;
      blocks.push({ type: 'quote', children: parseBlocks(quoted, depth + 1, sink) });
      continue;
    }

    const numbered = NUMBERED.exec(line.text);
    if (BULLET.test(line.text) || numbered) {
      flush();
      const ordered = numbered !== null;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        const item = l ? pattern.exec(l.text) : null;
        if (!l || !item) break;
        const prefix = item[1] ?? '';
        const content = item[ordered ? 3 : 2] ?? '';
        mark(sink, 'marker', l.at, l.at + prefix.length);
        items.push(parseText([{ text: content, at: l.at + prefix.length }], depth, sink));
      }
      i--;
      blocks.push({ type: 'list', ordered, start: ordered ? Number(numbered[2]) : 1, items });
      continue;
    }

    if (line.text.trim() === '') flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Inline content spread over lines, which may not be contiguous in the source (quotes, lists). */
function parseText(lines: Line[], depth: number, sink: Decoration[] | null): Inline[] {
  const text = lines.map((l) => l.text).join('\n');
  if (!sink) return parseInline(text, depth, null);
  // Where each character of `text` sits in the source; the joining newline sits after its line.
  const offsets: number[] = [];
  for (const l of lines) {
    for (let k = 0; k <= l.text.length; k++) offsets.push(l.at + k);
  }
  return parseInline(text, depth, { sink, offsets });
}

// ---- inline ----------------------------------------------------------------------------------

/** Present only when decorating: where each character of the string sits in the source. */
interface Positions {
  sink: Decoration[];
  offsets: number[];
}

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
 * Every position in `s` where `marker` could close an emphasis, in order. Code spans and escapes
 * are paired left to right, exactly as the main loop pairs them, and a single `*` never closes on
 * half of a `**`. Computed once per run of inline text, so each opener finds its closer by binary
 * search: linear-ish even for thousands of unclosed openers.
 */
function closingPositions(s: string, marker: string): number[] {
  const found: number[] = [];
  for (let i = 0; i < s.length; i++) {
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
    found.push(i);
  }
  return found;
}

/** The first of the sorted `positions` at or after `from`, or -1. */
function firstFrom(positions: number[], from: number): number {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((positions[mid] ?? Infinity) < from) lo = mid + 1;
    else hi = mid;
  }
  return positions[lo] ?? -1;
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

function parseInline(s: string, depth: number, positions: Positions | null): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  /** Records the source range of s[from, to) when decorating. */
  const at = (kind: DecorationKind, from: number, to: number) => {
    if (!positions || to <= from) return;
    const start = positions.offsets[from];
    const end = positions.offsets[to - 1];
    if (start !== undefined && end !== undefined) mark(positions.sink, kind, start, end + 1);
  };

  const closers = new Map<string, number[]>();
  const findClose = (from: number, marker: string) => {
    let positions = closers.get(marker);
    if (!positions) {
      positions = closingPositions(s, marker);
      closers.set(marker, positions);
    }
    return firstFrom(positions, from);
  };

  let i = 0;
  outer: while (i < s.length) {
    const c = s[i] ?? '';

    const next = s[i + 1];
    if (c === '\\' && next !== undefined && ESCAPABLE.has(next)) {
      at('marker', i, i + 1);
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
      at('code', i, end + n);
      at('marker', i, i + n);
      at('marker', end, end + n);
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
        const close = findClose(i + marker.length + 1, marker);
        if (close === -1) continue;
        const innerFrom = i + marker.length;
        at(type, i, close + marker.length);
        at('marker', i, innerFrom);
        flush();
        const innerPositions = positions && {
          sink: positions.sink,
          offsets: positions.offsets.slice(innerFrom, close),
        };
        out.push({
          type,
          children: parseInline(s.slice(innerFrom, close), depth + 1, innerPositions),
        });
        at('marker', close, close + marker.length);
        i = close + marker.length;
        continue outer;
      }
    }

    if (c === 'h' && !isWord(s[i - 1])) {
      const url = readUrl(s, i);
      if (url) {
        at('link', i, i + url.length);
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
        const everyone = name === 'everyone';
        at(everyone ? 'everyone' : 'mention', i, i + 1 + name.length);
        flush();
        out.push(everyone ? { type: 'everyone' } : { type: 'mention', username: name });
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
