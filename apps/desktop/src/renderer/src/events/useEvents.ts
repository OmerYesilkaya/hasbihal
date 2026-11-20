import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Occurrence, RoomEvent } from '@hasbihal/protocol';
import { useChat } from '../chat/context.tsx';
import { queryKeys, unwrap } from '../queries.ts';

export interface EventsView {
  events: ReadonlyMap<string, RoomEvent>;
  occurrences: Occurrence[];
  loaded: boolean;
}

const EMPTY: EventsView = { events: new Map(), occurrences: [], loaded: false };
const HOUR = 3_600_000;

/**
 * Occurrences from the last hour (still running) to `days` ahead, for one room or all, reloaded
 * whenever any room's events change (A15; the shell marks them stale). Events are fetched per
 * window, never kept in the store.
 */
export function useEvents(roomId: string | null, days: number): EventsView {
  const { client } = useChat();
  const { data } = useQuery({
    queryKey: queryKeys.eventWindow(roomId, days),
    queryFn: async (): Promise<EventsView> => {
      const now = Date.now();
      const window = await unwrap(
        client.events.window({
          from: new Date(now - HOUR).toISOString(),
          to: new Date(now + days * 24 * HOUR).toISOString(),
          ...(roomId ? { roomId } : {}),
        }),
      );
      return {
        events: new Map(window.events.map((e) => [e.id, e])),
        // What already ended is gone; skipped ones stay listed, marked.
        occurrences: window.occurrences.filter((o) => Date.parse(o.endsAt) > Date.now()),
        loaded: true,
      };
    },
    // Hourly too, so "tomorrow" becomes "today" in a window left open.
    refetchInterval: HOUR,
    // The window moves with the clock, and the Map isn't plain data to share structure with.
    structuralSharing: false,
  });
  return data ?? EMPTY;
}

/** Marks every event window stale, after a change to an event (also announced by the gateway). */
export function useRefreshEvents(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.events });
  };
}

/** The current time, refreshed every half minute: for "now" and "today" labels. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

/** The next occurrence that will happen (not skipped), if any. */
export const nextOccurrence = (view: EventsView, roomId?: string) =>
  view.occurrences.find(
    (o) => !o.skipped && (roomId === undefined || view.events.get(o.eventId)?.roomId === roomId),
  );
