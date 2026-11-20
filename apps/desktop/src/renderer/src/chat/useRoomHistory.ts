import { useCallback, useEffect, useRef, useState } from 'react';
import { roomMessages } from '@hasbihal/core';
import { useChat, useChatState } from './context.tsx';

const PAGE_SIZE = 50;

/**
 * A room's history: the latest page when it opens (or again after a resync dropped it), older
 * pages on demand. Messages live in the store; this only tracks paging.
 */
export function useRoomHistory(roomId: string) {
  const { client, store } = useChat();
  const loaded = useChatState().messages.has(roomId);
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (loaded || inFlight.current.has(roomId)) return;
    inFlight.current.add(roomId);
    void client.rooms.messages(roomId, { limit: PAGE_SIZE }).then((result) => {
      inFlight.current.delete(roomId);
      if (!result.ok) return;
      const page = result.value;
      store.addMessages(roomId, page.messages);
      setHasMore((h) => ({ ...h, [roomId]: page.hasMore }));
    });
  }, [roomId, loaded, client, store]);

  /** Loads the page before the oldest loaded message; resolves with how many arrived. */
  const loadOlder = useCallback(async (): Promise<number> => {
    const oldest = roomMessages(store.getSnapshot(), roomId)[0];
    const key = `${roomId}:older`;
    if (!oldest || inFlight.current.has(key)) return 0;
    inFlight.current.add(key);
    const result = await client.rooms.messages(roomId, { limit: PAGE_SIZE, before: oldest.id });
    inFlight.current.delete(key);
    if (!result.ok) return 0;
    const page = result.value;
    store.addMessages(roomId, page.messages);
    setHasMore((h) => ({ ...h, [roomId]: page.hasMore }));
    return page.messages.length;
  }, [roomId, client, store]);

  return { loaded, hasMore: hasMore[roomId] ?? false, loadOlder };
}
