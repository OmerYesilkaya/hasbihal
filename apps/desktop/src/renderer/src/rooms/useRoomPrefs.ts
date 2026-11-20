import type { RoomPrefs } from '@hasbihal/protocol';
import { useChat, useChatState } from '../chat/context.tsx';

/**
 * This member's settings for a room (A28: notifications; favourite), and a way to change some of
 * them: applied at once, then saved; the server tells this member's other devices.
 */
export function useRoomPrefs(
  roomId: string,
): [RoomPrefs | undefined, (change: Partial<RoomPrefs>) => void] {
  const { client, store } = useChat();
  const prefs = useChatState().rooms.get(roomId)?.prefs;
  const save = (change: Partial<RoomPrefs>) => {
    const current = store.getSnapshot().rooms.get(roomId)?.prefs;
    if (!current) return;
    const next = { ...current, ...change };
    store.setRoomPrefs(roomId, next);
    void client.rooms.setPrefs(roomId, next);
  };
  return [prefs, save];
}
