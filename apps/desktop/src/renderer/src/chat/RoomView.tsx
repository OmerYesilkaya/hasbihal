import { useCallback, useEffect, useState } from 'react';
import { roomMessages } from '@hasbihal/core';
import type { Message } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useT } from '../i18n.tsx';
import { HangoutPanel } from '../hangout/HangoutPanel.tsx';
import { Composer } from './Composer.tsx';
import { useChat, useChatState } from './context.tsx';
import { MessageList } from './MessageList.tsx';
import { TypingIndicator } from './TypingIndicator.tsx';

/** Whether this window has focus: messages only count as read when someone can see them. */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => {
      setFocused(true);
    };
    const off = () => {
      setFocused(false);
    };
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
}

/** One room's chat: header, history, typing, composer. Keyed by room, so state resets per room. */
export function RoomView({ roomId }: { roomId: string }) {
  const t = useT();
  const { info, store } = useChat();
  const state = useChatState();
  const room = state.rooms.get(roomId);
  const [readMarkerAtOpen] = useState(() => room?.lastReadMessageId ?? null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const focused = useWindowFocused();

  const messages = roomMessages(state, roomId);
  const latest = messages.at(-1);
  const marker = room?.lastReadMessageId ?? null;

  // Seen = at the bottom of a focused window. Move the marker there (forward only, server-side).
  useEffect(() => {
    if (!latest || !atBottom || !focused || latest.id === marker) return;
    store.setReadMarker(roomId, latest.id); // the badge clears now, not after the round trip
    void api(info.serverUrl, 'POST', `/rooms/${roomId}/read`, { body: { messageId: latest.id } });
  }, [latest, atBottom, focused, marker, roomId, store, info.serverUrl]);

  const reply = useCallback((message: Message) => {
    setEditing(null);
    setReplyTo(message);
  }, []);
  const edit = useCallback((message: Message) => {
    setReplyTo(null);
    setEditing(message);
  }, []);

  if (!room) return null;
  const readOnly = room.archivedAt !== null;

  return (
    <section className="room-view" aria-label={room.name}>
      <header className="content__header room-view__header">
        <h1 className="room-view__name">
          <span aria-hidden>#</span> {room.name}
        </h1>
        {room.topic && <p className="room-view__topic">{room.topic}</p>}
      </header>
      <HangoutPanel roomId={roomId} />
      <MessageList
        roomId={roomId}
        readMarkerAtOpen={readMarkerAtOpen}
        onAtBottomChange={setAtBottom}
        onReply={reply}
        onEdit={edit}
      />
      <TypingIndicator roomId={roomId} />
      {readOnly ? (
        <p className="room-view__archived">{t('room.archived')}</p>
      ) : (
        <Composer
          roomId={roomId}
          roomName={room.name}
          replyTo={replyTo}
          editing={editing}
          onCancel={() => {
            setReplyTo(null);
            setEditing(null);
          }}
          onEditLast={() => {
            const mine = [...messages]
              .reverse()
              .find((m) => m.authorId === state.me?.id && !m.deletedAt);
            if (mine) edit(mine);
          }}
        />
      )}
    </section>
  );
}
