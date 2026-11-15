import { useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { compareMessages, roomMessages } from '@hasbihal/core';
import type { Message } from '@hasbihal/protocol';
import { dayKey, formatDay, useT } from '../i18n.tsx';
import { useChatState } from './context.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { MessageItem } from './MessageItem.tsx';
import { useRoomHistory } from './useRoomHistory.ts';

/** Consecutive messages by one author within this window share a header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** Virtuoso's index base; it shrinks as older messages are prepended, keeping the view still. */
const START_INDEX = 1_000_000;

type Item =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'message'; key: string; message: Message; startsGroup: boolean };

interface MessageListProps {
  roomId: string;
  /** The read marker when the room was opened: the "new messages" line goes after it. */
  readMarkerAtOpen: string | null;
  onAtBottomChange: (atBottom: boolean) => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
}

/**
 * The room's history, virtualized (history is kept forever, A27): only what is on screen is
 * rendered. Starts at the bottom, follows new messages while at the bottom, and loads older
 * pages when scrolled to the top.
 */
export function MessageList({
  roomId,
  readMarkerAtOpen,
  onAtBottomChange,
  onReply,
  onEdit,
}: MessageListProps) {
  const t = useT();
  const state = useChatState();
  const { loaded, hasMore, loadOlder } = useRoomHistory(roomId);
  const messages = useMemo(() => roomMessages(state, roomId), [state, roomId]);
  const meId = state.me?.id;
  /**
   * Whether to keep the end in view. Only the reader scrolling away turns it off: the list's own
   * layout moves the scroll position too (growing past the window), which says nothing.
   */
  const stick = useRef(true);
  const scroller = useRef<HTMLElement | null>(null);
  const [follow] = useState(() => {
    let userUntil = 0;
    const byUser = (e: Event) => {
      // A press counts only on the scrollbar (the scroller itself), not a click on a message.
      if (e.type === 'pointerdown' && e.target !== scroller.current) return;
      userUntil = performance.now() + 500;
    };
    const onScroll = () => {
      const el = scroller.current;
      if (!el) return;
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      if (atEnd) stick.current = true;
      else if (performance.now() < userUntil) stick.current = false;
    };
    const events = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;
    return {
      attach(el: HTMLElement) {
        el.addEventListener('scroll', onScroll, { passive: true });
        for (const name of events) el.addEventListener(name, byUser, { passive: true });
      },
      detach(el: HTMLElement) {
        el.removeEventListener('scroll', onScroll);
        for (const name of events) el.removeEventListener(name, byUser);
      },
    };
  });

  const items = useMemo(() => {
    const marker = readMarkerAtOpen ? state.messages.get(roomId)?.get(readMarkerAtOpen) : undefined;
    const result: Item[] = [];
    let previous: Message | undefined;
    let unreadPlaced = false;
    for (const message of messages) {
      const day = dayKey(message.createdAt);
      const newDay = !previous || dayKey(previous.createdAt) !== day;
      if (newDay)
        result.push({ kind: 'day', key: `day:${day}`, label: formatDay(message.createdAt) });
      const unread =
        !unreadPlaced &&
        marker !== undefined &&
        message.authorId !== meId &&
        compareMessages(message, marker) > 0;
      if (unread) {
        result.push({ kind: 'unread', key: 'unread' });
        unreadPlaced = true;
      }
      const startsGroup =
        newDay ||
        unread ||
        previous?.authorId !== message.authorId ||
        Date.parse(message.createdAt) - Date.parse(previous.createdAt) > GROUP_WINDOW_MS;
      result.push({ kind: 'message', key: message.id, message, startsGroup });
      previous = message;
    }
    return result;
  }, [messages, readMarkerAtOpen, state.messages, roomId, meId]);

  // When older items are prepended, lower the index base by as many, so the view doesn't jump.
  const firstKey = items[0]?.key;
  const [previousFirstKey, setPreviousFirstKey] = useState(firstKey);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  if (firstKey !== previousFirstKey) {
    const shift = items.findIndex((item) => item.key === previousFirstKey);
    setPreviousFirstKey(firstKey);
    if (shift > 0) setFirstItemIndex((index) => index - shift);
  }

  if (!loaded) return <div className="message-list message-list--empty">{t('room.loading')}</div>;
  if (!items.length)
    return (
      <div className="message-list message-list--empty">
        <EmptyState>{t('room.empty')}</EmptyState>
      </div>
    );

  return (
    <Virtuoso
      className="message-list"
      data={items}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={items.length - 1}
      // A short conversation sits just above the composer, as in other chat apps.
      alignToBottom
      computeItemKey={(_, item) => item.key}
      followOutput={(atBottom) => (atBottom ? 'auto' : false)}
      atBottomThreshold={48}
      atBottomStateChange={onAtBottomChange}
      scrollerRef={(el) => {
        const node = el instanceof HTMLElement ? el : null;
        if (node === scroller.current) return;
        if (scroller.current) follow.detach(scroller.current);
        scroller.current = node;
        if (node) follow.attach(node);
      }}
      // Messages also grow after they arrive: pictures load, link previews come in. Someone
      // reading the latest messages keeps seeing the end of them (after layout settles).
      totalListHeightChanged={() => {
        if (!stick.current) return;
        requestAnimationFrame(() => {
          const el = scroller.current;
          if (el && stick.current) el.scrollTop = el.scrollHeight;
        });
      }}
      startReached={() => {
        if (hasMore) void loadOlder();
      }}
      increaseViewportBy={{ top: 600, bottom: 200 }}
      itemContent={(_, item) => {
        switch (item.kind) {
          case 'day':
            return (
              <div className="day-divider" role="separator">
                <span>{item.label}</span>
              </div>
            );
          case 'unread':
            return (
              <div className="unread-divider" role="separator">
                <span>{t('room.newMessages')}</span>
              </div>
            );
          case 'message':
            return (
              <MessageItem
                message={item.message}
                startsGroup={item.startsGroup}
                onReply={onReply}
                onEdit={onEdit}
              />
            );
        }
      }}
    />
  );
}
