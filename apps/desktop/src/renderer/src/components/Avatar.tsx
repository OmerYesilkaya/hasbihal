import { useEffect, useState } from 'react';
import { avatarColor } from '@hasbihal/core';
import { fileUrl } from '../api.ts';
import { useChat } from '../chat/context.tsx';
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

/** The local URL of a stored file, once it has loaded. */
function useFileUrl(fileId: string | null): string | null {
  const { info } = useChat();
  const [loaded, setLoaded] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let current = true;
    void fileUrl(info.serverUrl, fileId).then((url) => {
      if (current) setLoaded({ id: fileId, url });
    });
    return () => {
      current = false;
    };
  }, [fileId, info.serverUrl]);
  return loaded?.id === fileId ? loaded.url : null;
}

/**
 * The member's photo, or their initials on their color (A40), with an optional presence dot
 * (A21). The initials show while a photo loads, so nothing jumps.
 */
export function Avatar({
  user,
  presence,
  large,
}: {
  user: User;
  presence?: PresenceStatus;
  large?: boolean;
}) {
  const photo = useFileUrl(user.avatarFileId);
  return (
    <span
      className={large ? 'avatar avatar--large' : 'avatar'}
      style={{ background: avatarColor(user.avatarColor) }}
      aria-hidden
    >
      {photo ? (
        <img className="avatar__photo" src={photo} alt="" draggable={false} />
      ) : (
        initials(user.displayName)
      )}
      {presence && <span className="avatar__presence" data-presence={presence} />}
    </span>
  );
}
