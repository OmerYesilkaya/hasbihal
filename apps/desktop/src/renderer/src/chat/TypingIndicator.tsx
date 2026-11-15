import { useEffect, useState } from 'react';
import { typingIn } from '@hasbihal/core';
import { useT } from '../i18n.tsx';
import { useChatState } from './context.tsx';

/** "Ayşe yazıyor…" under the message list. Entries expire on their own (TYPING_TTL_MS). */
export function TypingIndicator({ roomId }: { roomId: string }) {
  const t = useT();
  const state = useChatState();
  const [now, setNow] = useState(() => Date.now());
  const anyone = (state.typing.get(roomId)?.size ?? 0) > 0;

  useEffect(() => {
    if (!anyone) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [anyone]);

  const names = typingIn(state, roomId, now)
    .filter((id) => id !== state.me?.id)
    .map((id) => state.members.get(id)?.displayName ?? '?');
  const [first, second] = names;
  let label = '';
  if (names.length === 1 && first) label = t('typing.one', { name: first });
  else if (names.length === 2 && first && second) label = t('typing.two', { first, second });
  else if (names.length > 2) label = t('typing.many');
  return (
    <div className="typing" aria-live="polite" data-testid="typing">
      {label}
    </div>
  );
}
