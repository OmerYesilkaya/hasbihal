import type { FastifyInstance } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import {
  AnswerKnockRequest,
  Id,
  KNOCK_COOLDOWN_MS,
  SetMahremRequest,
  type KnockResult,
  type Room,
  type ServerMessage,
} from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import { loadRoom, mahremList, toRoom } from '../chat/model.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { appendEvent } from '../gateway/events.ts';
import type { GatewayHub } from '../gateway/hub.ts';
import type { HangoutTracker } from '../hangouts/tracker.ts';
import type { MahremGate } from './gate.ts';

export interface MahremDeps {
  db: Kysely<Database>;
  hub: GatewayHub;
  tracker: HangoutTracker;
  gate: MahremGate;
  guards: AuthGuards;
}

const IdParam = z.object({ id: Id });
const KnockParams = z.object({ id: Id, userId: Id });

const noRoom = () => new AppError(404, 'not_found', 'No such room.');
const archived = () => new AppError(409, 'conflict', 'This room is archived.');
const notOnList = () =>
  new AppError(403, 'forbidden', 'Only people on this room’s Mahrem list can do this.');

/**
 * Mahrem rooms (A55; ARCHITECTURE §6.1): the list of who may join a room's call, and knocking for
 * everyone else. Only people on the list change it; there is no admin override.
 */
export function registerMahrem(app: FastifyInstance, deps: MahremDeps): void {
  const { db, hub, tracker, gate, guards } = deps;
  const { requireAuth, auth } = guards;

  /** The room, locked for the change, with its list as it is now. */
  const lockRoom = async (trx: Transaction<Database>, id: string) => {
    const room = await trx
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!room) throw noRoom();
    if (room.archived_at) throw archived();
    return { room, list: await mahremList(trx, id) };
  };

  /** Sends one message to every online member in `userIds`, except `skip`. */
  const tell = (userIds: Iterable<string>, message: ServerMessage, skip?: string) => {
    for (const userId of new Set(userIds)) if (userId !== skip) hub.sendToUser(userId, message);
  };

  /**
   * Replaces the list (empty turns it off), announces the room, tells everyone on the old or new
   * list who did it, and removes from the call anyone who may no longer be there.
   */
  const changeList = async (roomId: string, byUserId: string, next: string[] | null) => {
    const outcome = await db.transaction().execute(async (trx) => {
      const { room, list } = await lockRoom(trx, roomId);
      if (list.length && !list.includes(byUserId)) throw notOnList();
      const memberIds = next ?? [];
      if (!list.length && !memberIds.includes(byUserId))
        throw new AppError(400, 'validation_failed', 'Put yourself on the list.', [
          { path: ['body', 'memberIds'], message: 'Put yourself on the list.', code: 'not_self' },
        ]);
      if (memberIds.length) {
        const found = await trx
          .selectFrom('users')
          .select('id')
          .where('id', 'in', memberIds)
          .where('removed_at', 'is', null)
          .execute();
        if (found.length !== memberIds.length)
          throw new AppError(400, 'validation_failed', 'Someone on the list is not a member.');
      }
      const added = memberIds.filter((id) => !list.includes(id));
      const removed = list.filter((id) => !memberIds.includes(id));
      if (removed.length)
        await trx
          .deleteFrom('room_mahrem')
          .where('room_id', '=', roomId)
          .where('user_id', 'in', removed)
          .execute();
      if (added.length)
        await trx
          .insertInto('room_mahrem')
          .values(added.map((user_id) => ({ room_id: roomId, user_id, added_by: byUserId })))
          .execute();
      // The list in the order people were added, as everyone reads it back.
      const updated = toRoom(room, await mahremList(trx, roomId));
      if (added.length || removed.length)
        await appendEvent(trx, { type: 'room_updated', room: updated });
      return { room: updated, before: list, added, removed };
    });
    const { room, before, added, removed } = outcome;
    if (!added.length && !removed.length) return room;
    hub.eventsCommitted();
    if (!room.mahremMemberIds.length) gate.forget(roomId);
    tell(
      [...before, ...room.mahremMemberIds],
      {
        type: 'mahrem_changed',
        roomId,
        byUserId,
        memberIds: room.mahremMemberIds,
        added,
        removed,
      },
      byUserId,
    );
    await gate.enforce(
      roomId,
      tracker.participants(roomId).map((p) => p.userId),
    );
    return room;
  };

  app.put('/rooms/:id/mahrem', { preHandler: requireAuth }, async (request): Promise<Room> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    const { memberIds } = parseRequest(SetMahremRequest, request.body, 'body');
    return changeList(id, auth(request).userId, memberIds);
  });

  app.delete('/rooms/:id/mahrem', { preHandler: requireAuth }, async (request): Promise<Room> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    const { userId } = auth(request);
    const list = await mahremList(db, id);
    if (!list.length) {
      // Already open: nothing to turn off.
      const room = await loadRoom(db, id);
      if (!room) throw noRoom();
      return room;
    }
    if (!list.includes(userId)) throw notOnList();
    return changeList(id, userId, null);
  });

  // ---- knocking ----------------------------------------------------------------------------

  const lastKnock = new Map<string, number>();
  app.post(
    '/rooms/:id/mahrem/knock',
    { preHandler: requireAuth },
    async (request): Promise<KnockResult> => {
      const { id } = parseRequest(IdParam, request.params, 'params');
      const { userId } = auth(request);
      const room = await db
        .selectFrom('rooms')
        .select('archived_at')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!room) throw noRoom();
      if (room.archived_at) throw archived();
      const list = await mahremList(db, id);
      if (!list.length) throw new AppError(409, 'conflict', 'This room is open: join it.');
      if (list.includes(userId))
        throw new AppError(409, 'conflict', 'You are on the list: join it.');
      const key = `${userId}:${id}`;
      const now = Date.now();
      if (now - (lastKnock.get(key) ?? 0) < KNOCK_COOLDOWN_MS)
        throw new AppError(429, 'rate_limited', 'You knocked a moment ago.');
      lastKnock.set(key, now);
      if (lastKnock.size > 10_000) lastKnock.clear(); // bounded, whatever happens
      gate.knock(id, userId);
      // Busy (A19) silences knocks like any notification.
      let delivered = 0;
      for (const memberId of list)
        if (!hub.isBusy(memberId))
          delivered += hub.sendToUser(memberId, { type: 'knock', roomId: id, userId });
      return { delivered: delivered > 0 };
    },
  );

  app.post(
    '/rooms/:id/mahrem/knocks/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, userId: knocker } = parseRequest(KnockParams, request.params, 'params');
      const { admit } = parseRequest(AnswerKnockRequest, request.body, 'body');
      const byUserId = auth(request).userId;
      const list = await mahremList(db, id);
      if (!list.includes(byUserId)) throw notOnList();
      // Someone else on the list answered first, or it lapsed.
      if (!gate.takeKnock(id, knocker))
        throw new AppError(409, 'conflict', 'This knock was already answered.');
      if (admit) gate.grant(id, knocker);
      tell([knocker, ...list], {
        type: 'knock_answered',
        roomId: id,
        userId: knocker,
        admit,
        byUserId,
      });
      return reply.code(204).send();
    },
  );
}
