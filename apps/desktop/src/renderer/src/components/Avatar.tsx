import { avatarColor } from '@hasbihal/core';
import type { PresenceStatus, User } from '@hasbihal/protocol';

const graphemes = new Intl.Segmenter('tr', { granularity: 'grapheme' });

/**
 * "ömer faruk" → "ÖF". Whole graphemes (an "Ö" may be two code points), Turkish upper case,
 * so "i" becomes "İ".
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? '')
    .join('')
    .toLocaleUpperCase('tr-TR');
}

/** Initials on the member's color (A40), with an optional presence dot (A21). */
export function Avatar({ user, presence }: { user: User; presence?: PresenceStatus }) {
  return (
    <span className="avatar" style={{ background: avatarColor(user.avatarColor) }} aria-hidden>
      {initials(user.displayName)}
      {presence && <span className="avatar__presence" data-presence={presence} />}
    </span>
  );
}
