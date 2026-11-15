import { useCallback, useEffect, useRef, useState } from 'react';
import { roomMessages } from '@hasbihal/core';
import { MessagePage } from '@hasbihal/protocol';
import { apiGet } from '../api.ts';
import { useChat, useChatState } from './context.tsx';

const PAGE_SIZE = 50;

/**
 * A room's history: the latest page when it opens (or again after a resync dropped it), older
 * pages on demand. Messages live in the store; this only tracks paging.
 */
export function useRoomHistory(roomId: string) {
  const { info, store } = useChat();
  const loaded = useChatState().messages.has(roomId);
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (loaded || inFlight.current.has(roomId)) return;
    inFlight.current.add(roomId);
    void apiGet(
      info.serverUrl,
      `/rooms/${roomId}/messages?limit=${String(PAGE_SIZE)}`,
      MessagePage,
    ).then((page) => {
      inFlight.current.delete(roomId);
      if (!page) return;
      store.addMessages(roomId, page.messages);
      setHasMore((h) => ({ ...h, [roomId]: page.hasMore }));
    });
  }, [roomId, loaded, info.serverUrl, store]);

  /** Loads the page before the oldest loaded message; resolves with how many arrived. */
  const loadOlder = useCallback(async (): Promise<number> => {
    const oldest = roomMessages(store.getSnapshot(), roomId)[0];
    const key = `${roomId}:older`;
    if (!oldest || inFlight.current.has(key)) return 0;
    inFlight.current.add(key);
    const page = await apiGet(
      info.serverUrl,
      `/rooms/${roomId}/messages?limit=${String(PAGE_SIZE)}&before=${oldest.id}`,
      MessagePage,
    );
    inFlight.current.delete(key);
    if (!page) return 0;
    store.addMessages(roomId, page.messages);
    setHasMore((h) => ({ ...h, [roomId]: page.hasMore }));
    return page.messages.length;
  }, [roomId, info.serverUrl, store]);

  return { loaded, hasMore: hasMore[roomId] ?? false, loadOlder };
}
