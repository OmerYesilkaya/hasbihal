import type { HangoutParticipant } from '@hasbihal/protocol';

export type Snapshot = Map<string, HangoutParticipant[]>;

export interface TrackerListener {
  /** A room's participants changed (empty when the last one left). */
  changed(roomId: string, participants: HangoutParticipant[]): void;
  /** Someone joined an empty room (A28). */
  started(roomId: string, userId: string): void;
}

/**
 * Who is in which room's hangout (ARCHITECTURE §6.3), fed by LiveKit webhooks and corrected by
 * a periodic full listing, so a webhook lost to a restart can't leave a ghost behind.
 */
export class HangoutTracker {
  readonly #rooms = new Map<string, Map<string, HangoutParticipant>>();
  readonly #listener: TrackerListener;

  constructor(listener: TrackerListener) {
    this.#listener = listener;
  }

  snapshot(): Record<string, HangoutParticipant[]> {
    return Object.fromEntries(
      [...this.#rooms].map(([roomId, people]) => [roomId, [...people.values()]]),
    );
  }

  participants(roomId: string): HangoutParticipant[] {
    return [...(this.#rooms.get(roomId)?.values() ?? [])];
  }

  join(roomId: string, userId: string, joinedAt: Date): void {
    const room = this.#rooms.get(roomId) ?? new Map<string, HangoutParticipant>();
    if (room.has(userId)) return; // a reconnect, or the same user's other device taking over
    const wasEmpty = room.size === 0;
    room.set(userId, {
      userId,
      joinedAt: joinedAt.toISOString(),
      camera: false,
      screenShare: false,
    });
    this.#rooms.set(roomId, room);
    this.#changed(roomId);
    if (wasEmpty) this.#listener.started(roomId, userId);
  }

  leave(roomId: string, userId: string): void {
    const room = this.#rooms.get(roomId);
    if (!room?.delete(userId)) return;
    if (!room.size) this.#rooms.delete(roomId);
    this.#changed(roomId);
  }

  setTrack(roomId: string, userId: string, track: 'camera' | 'screenShare', on: boolean): void {
    const person = this.#rooms.get(roomId)?.get(userId);
    if (!person || person[track] === on) return;
    this.#rooms.get(roomId)?.set(userId, { ...person, [track]: on });
    this.#changed(roomId);
  }

  /** Replaces everything with a full listing from LiveKit; announces only rooms that differ. */
  reconcile(actual: Snapshot): void {
    const roomIds = new Set([...this.#rooms.keys(), ...actual.keys()]);
    for (const roomId of roomIds) {
      const next = actual.get(roomId) ?? [];
      const current = this.participants(roomId);
      const same =
        next.length === current.length &&
        next.every((p) => {
          const c = this.#rooms.get(roomId)?.get(p.userId);
          return c?.camera === p.camera && c.screenShare === p.screenShare;
        });
      if (same) continue;
      if (next.length) this.#rooms.set(roomId, new Map(next.map((p) => [p.userId, p])));
      else this.#rooms.delete(roomId);
      this.#changed(roomId);
    }
  }

  clear(roomId: string): void {
    if (this.#rooms.delete(roomId)) this.#changed(roomId);
  }

  #changed(roomId: string): void {
    this.#listener.changed(roomId, this.participants(roomId));
  }
}
