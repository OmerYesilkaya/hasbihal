import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import { KNOCK_TTL_MS } from '@hasbihal/protocol';
import { mahremList } from '../chat/model.ts';
import type { Database } from '../db/schema.ts';
import type { LiveKitRooms } from '../hangouts/livekit.ts';

/**
 * Who may be in a Mahrem room's call (A55): the people on its list, and those let in after
 * knocking. Knocks and passes live in memory: a restart forgets them, which only means knocking
 * again. The list itself is in the database (`room_mahrem`).
 */
export class MahremGate {
  readonly #db: Kysely<Database>;
  readonly #rooms: LiveKitRooms;
  readonly #log: FastifyBaseLogger;
  readonly #now: () => number;
  /** roomId → userId → when an unused pass lapses; null once they're in the call. */
  readonly #passes = new Map<string, Map<string, number | null>>();
  /** roomId → who knocked → when their knock lapses unanswered. */
  readonly #knocks = new Map<string, Map<string, number>>();

  constructor(deps: {
    db: Kysely<Database>;
    rooms: LiveKitRooms;
    log: FastifyBaseLogger;
    now?: () => number;
  }) {
    this.#db = deps.db;
    this.#rooms = deps.rooms;
    this.#log = deps.log;
    this.#now = deps.now ?? Date.now;
  }

  /** Whether `userId` may join the room's call now: it's open, they're on the list, or let in. */
  async mayJoin(roomId: string, userId: string): Promise<boolean> {
    const list = await mahremList(this.#db, roomId);
    return this.#allowed(list, roomId, userId);
  }

  /**
   * Removes from the room's call everyone in `present` who may not be there, e.g. after the list
   * changed, or when LiveKit reports a join with a token issued before the room became Mahrem.
   */
  async enforce(roomId: string, present: readonly string[]): Promise<void> {
    if (!present.length) return;
    const list = await mahremList(this.#db, roomId);
    const outsiders = present.filter((userId) => !this.#allowed(list, roomId, userId));
    await Promise.all(
      outsiders.map((userId) =>
        this.#rooms.remove(roomId, userId).then(
          () => {
            this.#log.info({ roomId, userId }, 'removed from a Mahrem call (A55)');
          },
          (error: unknown) => {
            this.#log.error({ err: error, roomId, userId }, 'could not remove from a Mahrem call');
          },
        ),
      ),
    );
  }

  // ---- knocks ------------------------------------------------------------------------------

  knock(roomId: string, userId: string): void {
    this.#prune();
    this.#entry(this.#knocks, roomId).set(userId, this.#now() + KNOCK_TTL_MS);
  }

  /** Takes an unanswered knock off the door: true if there was one to answer. */
  takeKnock(roomId: string, userId: string): boolean {
    const lapses = this.#knocks.get(roomId)?.get(userId);
    this.#knocks.get(roomId)?.delete(userId);
    return lapses !== undefined && lapses > this.#now();
  }

  // ---- passes ------------------------------------------------------------------------------

  /** Let in after knocking: for one call, if they join within `KNOCK_TTL_MS`. */
  grant(roomId: string, userId: string): void {
    this.#prune();
    this.#entry(this.#passes, roomId).set(userId, this.#now() + KNOCK_TTL_MS);
  }

  /** They're in the call: a pass now lasts until they leave it. */
  joined(roomId: string, userId: string): void {
    if (this.#hasPass(roomId, userId)) this.#passes.get(roomId)?.set(userId, null);
  }

  left(roomId: string, userId: string): void {
    this.#passes.get(roomId)?.delete(userId);
  }

  /** The room is open again: nobody is waiting at its door. */
  forget(roomId: string): void {
    this.#passes.delete(roomId);
    this.#knocks.delete(roomId);
  }

  // ---- internals ---------------------------------------------------------------------------

  #allowed(list: readonly string[], roomId: string, userId: string): boolean {
    return !list.length || list.includes(userId) || this.#hasPass(roomId, userId);
  }

  #hasPass(roomId: string, userId: string): boolean {
    const lapses = this.#passes.get(roomId)?.get(userId);
    return lapses === null || (lapses !== undefined && lapses > this.#now());
  }

  #entry<V>(maps: Map<string, Map<string, V>>, roomId: string): Map<string, V> {
    let map = maps.get(roomId);
    if (!map) maps.set(roomId, (map = new Map<string, V>()));
    return map;
  }

  /** Drops lapsed knocks and unused passes, so neither map grows without bound. */
  #prune(): void {
    const now = this.#now();
    for (const maps of [this.#knocks, this.#passes] as Map<string, Map<string, number | null>>[]) {
      for (const [roomId, map] of maps) {
        for (const [userId, lapses] of map)
          if (lapses !== null && lapses <= now) map.delete(userId);
        if (!map.size) maps.delete(roomId);
      }
    }
  }
}
