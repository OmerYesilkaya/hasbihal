import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { roomMessages } from '@hasbihal/core';
import type { Message } from '@hasbihal/protocol';
import { useT } from '../i18n.tsx';
import { EventChip } from '../events/EventChip.tsx';
import { EventsDialog } from '../events/EventsDialog.tsx';
import { nextOccurrence, useEvents } from '../events/useEvents.ts';
import { HangoutPanel } from '../hangout/HangoutPanel.tsx';
import { PanelToggle } from '../layout/panels.tsx';
import { RoomPrefsMenu } from '../rooms/RoomPrefsMenu.tsx';
import { Composer, type ComposerHandle } from './Composer.tsx';
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
  const { client, store } = useChat();
  const state = useChatState();
  const room = state.rooms.get(roomId);
  const [readMarkerAtOpen] = useState(() => room?.lastReadMessageId ?? null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const focused = useWindowFocused();
  const composer = useRef<ComposerHandle>(null);
  const [dragging, setDragging] = useState(false);
  // A16: the room's events, four weeks ahead (the chip shows the next one).
  const events = useEvents(roomId, 28);
  const [eventsOpen, setEventsOpen] = useState(false);

  const messages = roomMessages(state, roomId);
  const latest = messages.at(-1);
  const marker = room?.lastReadMessageId ?? null;

  // Seen = at the bottom of a focused window. Move the marker there (forward only, server-side).
  useEffect(() => {
    if (!latest || !atBottom || !focused || latest.id === marker) return;
    store.setReadMarker(roomId, latest.id); // the badge clears now, not after the round trip
    void client.rooms.markRead(roomId, { messageId: latest.id });
  }, [latest, atBottom, focused, marker, roomId, store, client]);

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
  /** Files dragged in from the desktop (not text or links dragged within the page). */
  const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <section
      className="room-view"
      aria-label={room.name}
      data-dragging={dragging ? true : undefined}
      onDragOver={(e) => {
        if (readOnly || !carriesFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (readOnly || !carriesFiles(e)) return;
        e.preventDefault();
        composer.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="content__header room-view__header">
        <PanelToggle side="rooms" />
        <h1 className="room-view__name">
          <span aria-hidden>#</span> {room.name}
        </h1>
        {room.topic && <p className="room-view__topic">{room.topic}</p>}
        <div className="room-view__actions">
          {/* Members see it when something is coming up; admins always, to add one. */}
          {(nextOccurrence(events, roomId) !== undefined || state.me?.role === 'admin') && (
            <EventChip
              view={events}
              roomId={roomId}
              onOpen={() => {
                setEventsOpen(true);
              }}
            />
          )}
          <RoomPrefsMenu roomId={roomId} />
          <PanelToggle side="members" />
        </div>
      </header>
      {eventsOpen && (
        <EventsDialog
          roomId={roomId}
          view={events}
          onClose={() => {
            setEventsOpen(false);
          }}
        />
      )}
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
          ref={composer}
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
      {dragging && (
        <div className="room-view__drop" aria-hidden>
          {t('composer.dropHere')}
        </div>
      )}
    </section>
  );
}
