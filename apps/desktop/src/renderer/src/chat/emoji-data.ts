import { Emoji } from '@hasbihal/protocol';
import type { Locale } from '@hasbihal/core';

/** One emoji in the full picker. */
export interface EmojiEntry {
  emoji: string;
  /** Unicode's group (emojibase numbering): 0 smileys … 9 flags. */
  group: number;
  /** Its name in each language, for the tooltip. */
  name: Record<Locale, string>;
  /** Names and keywords in both languages, folded (`foldForSearch`). */
  search: string;
}

/** The groups in picker order; 2 ("component": skin tones, hair) is left out. */
export const EMOJI_GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9] as const;
export type EmojiGroup = (typeof EMOJI_GROUPS)[number];

/**
 * The newest emoji version every supported system draws (A49: macOS 14.2 has Emoji 15.0).
 * Newer ones would show as empty boxes there.
 */
const MAX_VERSION = 15;

/** Turkish-aware search folding, like message search (A27): ı/i, ş/s, ç/c, ğ/g, ö/o, ü/u. */
export function foldForSearch(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

let loading: Promise<EmojiEntry[]> | null = null;

/**
 * Every emoji, loaded the first time the full picker opens (about 1 MB of names, kept out of
 * the app's start-up): Unicode's list from emojibase, Turkish names from CLDR.
 */
export function loadEmoji(): Promise<EmojiEntry[]> {
  loading ??= Promise.all([
    import('emojibase-data/en/data.json'),
    import('cldr-annotations-full/annotations/tr/annotations.json'),
  ]).then(([en, tr]) => {
    const turkish = tr.default.annotations.annotations as Record<
      string,
      { default?: string[]; tts?: string[] } | undefined
    >;
    return en.default
      .filter(
        (e) =>
          e.group !== undefined &&
          e.group !== 2 &&
          e.version <= MAX_VERSION &&
          Emoji.safeParse(e.emoji).success, // what the server accepts as a reaction
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => {
        // CLDR keys emoji without the variation selector, e.g. "❤" for "❤️".
        const tr = turkish[e.emoji] ?? turkish[e.emoji.replace(/️/g, '')];
        const trName = tr?.tts?.[0] ?? e.label;
        return {
          emoji: e.emoji,
          group: e.group ?? 0,
          name: { en: e.label, tr: trName },
          search: foldForSearch(
            [e.label, ...(e.tags ?? []), trName, ...(tr?.default ?? [])].join(' '),
          ),
        };
      });
  });
  return loading;
}
