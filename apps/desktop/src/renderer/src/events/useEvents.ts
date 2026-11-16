import { useEffect, useState } from 'react';
import { EventWindow, type Occurrence, type RoomEvent } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useChat, useChatState } from '../chat/context.tsx';

export interface EventsView {
  events: ReadonlyMap<string, RoomEvent>;
  occurrences: Occurrence[];
  loaded: boolean;
}

const EMPTY: EventsView = { events: new Map(), occurrences: [], loaded: false };
const HOUR = 3_600_000;

/**
 * Occurrences from the last hour (still running) to `days` ahead, for one room or all, reloaded
 * whenever any room's events change (A15). Events are fetched per window, never kept in the store.
 */
export function useEvents(roomId: string | null, days: number): EventsView {
  const { info } = useChat();
  const { eventsRevision } = useChatState();
  const [view, setView] = useState<EventsView>(EMPTY);
  // Reload hourly too, so "tomorrow" becomes "today" in a window left open.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((n) => n + 1);
    }, HOUR);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let current = true;
    const now = Date.now();
    const query = new URLSearchParams({
      from: new Date(now - HOUR).toISOString(),
      to: new Date(now + days * 24 * HOUR).toISOString(),
      ...(roomId ? { roomId } : {}),
    });
    void api(info.serverUrl, 'GET', `/events?${query.toString()}`, { schema: EventWindow }).then(
      (result) => {
        if (!current || !result.ok || !result.value) return;
        setView({
          events: new Map(result.value.events.map((e) => [e.id, e])),
          // What already ended is gone; skipped ones stay listed, marked.
          occurrences: result.value.occurrences.filter((o) => Date.parse(o.endsAt) > Date.now()),
          loaded: true,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [info.serverUrl, roomId, days, eventsRevision, tick]);
  return view;
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
