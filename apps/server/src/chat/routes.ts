import type { FastifyInstance } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import {
  CreateRoomRequest,
  EditMessageRequest,
  Emoji,
  Id,
  MarkReadRequest,
  MessagePageQuery,
  RoomPrefs,
  SearchQuery,
  SendMessageRequest,
  type SearchResults,
  UpdateRoomRequest,
  type Message,
  type MessagePage,
  type Room,
  type RoomList,
} from '@hasbihal/protocol';
import { newId } from '@hasbihal/core';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { appendEvent } from '../gateway/events.ts';
import type { GatewayHub } from '../gateway/hub.ts';
import { linkMessage } from '../previews/service.ts';
import {
  hydrateMessages,
  loadMessage,
  mahremList,
  resolveMentions,
  roomsWithState,
  toRoom,
} from './model.ts';

export interface ChatDeps {
  db: Kysely<Database>;
  hub: GatewayHub;
  guards: AuthGuards;
  /** Wakes the job queue after a commit that queued work (link previews). */
  jobsQueued: () => void;
}

const IdParam = z.object({ id: Id });
const ReactionParams = z.object({ id: Id, emoji: Emoji });

const noRoom = () => new AppError(404, 'not_found', 'No such room.');
const noMessage = () => new AppError(404, 'not_found', 'No such message.');
const archived = () => new AppError(409, 'conflict', 'This room is archived.');
const notYours = () => new AppError(403, 'forbidden', 'Only the author can change this message.');

/** Moves a member's read marker forward to `messageId`, never back. Returns whether it moved. */
async function advanceReadMarker(
  db: Kysely<Database>,
  roomId: string,
  userId: string,
  messageId: string,
): Promise<boolean> {
  const result = await sql`
    insert into room_user_prefs (room_id, user_id, last_read_message_id)
    values (${roomId}, ${userId}, ${messageId})
    on conflict (room_id, user_id) do update set last_read_message_id = excluded.last_read_message_id
    where room_user_prefs.last_read_message_id is null
      or (select (created_at, id) from messages where id = excluded.last_read_message_id)
       > (select (created_at, id) from messages where id = room_user_prefs.last_read_message_id)
  `.execute(db);
  return (result.numAffectedRows ?? 0n) > 0n;
}

/**
 * Rooms (A8, A12) and messages (A22). Every change appends a durable event in its own
 * transaction, then wakes the gateway hub, which sends it out in order (ARCHITECTURE §5).
 */
export function registerChat(
  app: FastifyInstance,
  { db, hub, guards, jobsQueued }: ChatDeps,
): void {
  const { requireAuth, requireAdmin, auth } = guards;

  /** Runs a change and the event describing it in one transaction, then delivers the event. */
  const commit = async <T>(change: (trx: Transaction<Database>) => Promise<T>): Promise<T> => {
    const result = await db.transaction().execute(change);
    hub.eventsCommitted();
    jobsQueued();
    return result;
  };

  const roomFor = async (trx: Kysely<Database>, id: string) => {
    const room = await trx
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!room) throw noRoom();
    return room;
  };

  const sendReadState = (userId: string, roomId: string, lastReadMessageId: string) => {
    hub.sendToUser(userId, { type: 'read_state', roomId, lastReadMessageId });
  };

  // ---- rooms ---------------------------------------------------------------------------------

  app.get('/rooms', { preHandler: requireAuth }, async (request): Promise<RoomList> => ({
    rooms: await roomsWithState(db, auth(request).userId),
  }));

  app.post('/rooms', { preHandler: requireAdmin }, async (request, reply): Promise<Room> => {
    const body = parseRequest(CreateRoomRequest, request.body, 'body');
    const room = await commit(async (trx) => {
      const { max } = await trx
        .selectFrom('rooms')
        .select((eb) => eb.fn.max<number | null>('position').as('max'))
        .executeTakeFirstOrThrow();
      const row = await trx
        .insertInto('rooms')
        .values({
          id: newId(),
          name: body.name,
          topic: body.topic ?? null,
          position: (max ?? 0) + 1,
          created_by: auth(request).userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const created = toRoom(row, []);
      await appendEvent(trx, { type: 'room_created', room: created });
      return created;
    });
    void reply.code(201);
    return room;
  });

  /** Applies a change to a room and announces the result. */
  const updateRoom = (
    id: string,
    change: { name?: string; topic?: string | null; archived_at?: Date | null },
  ) =>
    commit(async (trx) => {
      await roomFor(trx, id);
      const row = await trx
        .updateTable('rooms')
        .set(change)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const room = toRoom(row, await mahremList(trx, id));
      await appendEvent(trx, { type: 'room_updated', room });
      return room;
    });

  app.patch('/rooms/:id', { preHandler: requireAdmin }, async (request): Promise<Room> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    const body = parseRequest(UpdateRoomRequest, request.body, 'body');
    return updateRoom(id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.topic === undefined ? {} : { topic: body.topic }),
    });
  });

  app.post('/rooms/:id/archive', { preHandler: requireAdmin }, async (request): Promise<Room> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    return updateRoom(id, { archived_at: new Date() });
  });

  app.post('/rooms/:id/unarchive', { preHandler: requireAdmin }, async (request): Promise<Room> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    return updateRoom(id, { archived_at: null });
  });

  app.delete('/rooms/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    await commit(async (trx) => {
      await roomFor(trx, id);
      await trx.deleteFrom('rooms').where('id', '=', id).execute(); // messages go with it
      await appendEvent(trx, { type: 'room_deleted', roomId: id });
    });
    return reply.code(204).send();
  });

  // ---- messages ------------------------------------------------------------------------------

  app.get(
    '/rooms/:id/messages',
    { preHandler: requireAuth },
    async (request): Promise<MessagePage> => {
      const { id } = parseRequest(IdParam, request.params, 'params');
      const { before, limit } = parseRequest(MessagePageQuery, request.query, 'query');
      const room = await db
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!room) throw noRoom();

      let query = db.selectFrom('messages').selectAll().where('room_id', '=', id);
      if (before) {
        const cursor = await db
          .selectFrom('messages')
          .select(['created_at', 'id'])
          .where('id', '=', before)
          .where('room_id', '=', id)
          .executeTakeFirst();
        if (!cursor) throw noMessage();
        query = query.where((eb) =>
          eb(eb.refTuple('created_at', 'id'), '<', eb.tuple(cursor.created_at, cursor.id)),
        );
      }
      const rows = await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)
        .execute();
      const hasMore = rows.length > limit;
      return { messages: await hydrateMessages(db, rows.slice(0, limit).reverse()), hasMore };
    },
  );

  // ---- search (A27) ---------------------------------------------------------------------------

  /** Every word, as a prefix, folded like the index (migration 0007): all must match. */
  const searchTerms = (q: string): string | null => {
    const words = q
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 8);
    return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
  };

  app.get('/search', { preHandler: requireAuth }, async (request): Promise<SearchResults> => {
    const query = parseRequest(SearchQuery, request.query, 'query');
    const terms = searchTerms(query.q);
    if (!terms) return { messages: [], hasMore: false };
    let search = db
      .selectFrom('messages')
      .selectAll()
      .where(sql<boolean>`search_vector @@ to_tsquery('simple', hasbihal_fold(${terms}))`)
      .where('deleted_at', 'is', null);
    if (query.roomId) search = search.where('room_id', '=', query.roomId);
    if (query.before) {
      const cursor = await db
        .selectFrom('messages')
        .select(['created_at', 'id'])
        .where('id', '=', query.before)
        .executeTakeFirst();
      if (cursor)
        search = search.where(
          sql<boolean>`(created_at, id) < (${cursor.created_at}, ${cursor.id})`,
        );
    }
    const rows = await search
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return {
      messages: await hydrateMessages(db, rows.slice(0, query.limit)),
      hasMore: rows.length > query.limit,
    };
  });

  app.post(
    '/rooms/:id/messages',
    { preHandler: requireAuth },
    async (request, reply): Promise<Message> => {
      const { id: roomId } = parseRequest(IdParam, request.params, 'params');
      const body = parseRequest(SendMessageRequest, request.body, 'body');
      const { userId } = auth(request);

      // A retry of a message that already arrived: answer with it, change nothing (ARCHITECTURE §3.4).
      // The same id from someone else, or for another room, is a collision, not a retry.
      const retryOf = (found: Message | undefined): Message => {
        if (found?.authorId !== userId || found.roomId !== roomId) {
          throw new AppError(409, 'conflict', 'This message id is taken.');
        }
        return found;
      };
      const existing = await loadMessage(db, body.id);
      if (existing) return retryOf(existing);

      const mentions = await resolveMentions(db, body.body);
      const message = await commit(async (trx) => {
        const room = await roomFor(trx, roomId);
        if (room.archived_at) throw archived();
        if (body.replyToId) {
          const target = await trx
            .selectFrom('messages')
            .select('id')
            .where('id', '=', body.replyToId)
            .where('room_id', '=', roomId)
            .executeTakeFirst();
          if (!target)
            throw new AppError(
              400,
              'validation_failed',
              'The replied-to message is not in this room.',
            );
        }
        // Only the sender's own uploads, each on one message only (A26).
        if (body.attachmentIds.length) {
          const usable = await trx
            .selectFrom('files')
            .select('id')
            .where('id', 'in', body.attachmentIds)
            .where('uploader_id', '=', userId)
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('attachments')
                    .select('attachments.file_id')
                    .whereRef('attachments.file_id', '=', 'files.id'),
                ),
              ),
            )
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('users')
                    .select('users.id')
                    .whereRef('users.avatar_file_id', '=', 'files.id'),
                ),
              ),
            )
            .execute();
          if (usable.length !== body.attachmentIds.length)
            throw new AppError(
              400,
              'validation_failed',
              'A file is missing, not yours, or already sent.',
            );
        }
        const inserted = await trx
          .insertInto('messages')
          .values({
            id: body.id,
            room_id: roomId,
            author_id: userId,
            body: body.body,
            reply_to_id: body.replyToId ?? null,
            mentions_everyone: mentions.everyone,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .returningAll()
          .executeTakeFirst();
        if (!inserted) return null; // a concurrent retry won the race
        if (body.attachmentIds.length) {
          await trx
            .insertInto('attachments')
            .values(
              body.attachmentIds.map((file_id, position) => ({
                message_id: inserted.id,
                file_id,
                position,
              })),
            )
            .execute();
        }
        if (mentions.userIds.length) {
          await trx
            .insertInto('message_mentions')
            .values(mentions.userIds.map((user_id) => ({ message_id: inserted.id, user_id })))
            .execute();
        }
        await linkMessage(trx, inserted.id, inserted.body);
        const [created] = await hydrateMessages(trx, [inserted]);
        if (!created) throw new Error('message vanished');
        await appendEvent(trx, { type: 'message_created', message: created });
        return created;
      });
      if (!message) return retryOf(await loadMessage(db, body.id)); // a concurrent retry won

      // Your own message is read by definition: move your marker past it, on all your devices.
      if (await advanceReadMarker(db, roomId, userId, message.id))
        sendReadState(userId, roomId, message.id);
      void reply.code(201);
      return message;
    },
  );

  /** Loads a message for a change by its author, refusing deleted messages and archived rooms. */
  const ownMessage = async (trx: Transaction<Database>, id: string, userId: string) => {
    const row = await trx
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw noMessage();
    if (row.author_id !== userId) throw notYours();
    const room = await roomFor(trx, row.room_id);
    if (room.archived_at) throw archived();
    return row;
  };

  app.patch('/messages/:id', { preHandler: requireAuth }, async (request): Promise<Message> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    const body = parseRequest(EditMessageRequest, request.body, 'body');
    const { userId } = auth(request);
    const mentions = await resolveMentions(db, body.body);
    return commit(async (trx) => {
      const row = await ownMessage(trx, id, userId);
      if (row.deleted_at)
        throw new AppError(409, 'conflict', 'A deleted message cannot be edited.');
      if (!body.body) {
        // Only a message with files may be left without words.
        const file = await trx
          .selectFrom('attachments')
          .select('file_id')
          .where('message_id', '=', id)
          .executeTakeFirst();
        if (!file) throw new AppError(400, 'validation_failed', 'Write something.');
      }
      const updated = await trx
        .updateTable('messages')
        .set({ body: body.body, edited_at: new Date(), mentions_everyone: mentions.everyone })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.deleteFrom('message_mentions').where('message_id', '=', id).execute();
      if (mentions.userIds.length) {
        await trx
          .insertInto('message_mentions')
          .values(mentions.userIds.map((user_id) => ({ message_id: id, user_id })))
          .execute();
      }
      await linkMessage(trx, id, updated.body);
      const [message] = await hydrateMessages(trx, [updated]);
      if (!message) throw new Error('message vanished');
      await appendEvent(trx, { type: 'message_updated', message });
      return message;
    });
  });

  /** Leaves a "Bu mesaj silindi." placeholder (A22): the row stays, its content goes. */
  app.delete('/messages/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    const { userId } = auth(request);
    await commit(async (trx) => {
      const row = await ownMessage(trx, id, userId);
      if (row.deleted_at) return; // already gone: deleting again is a no-op
      const deleted = await trx
        .updateTable('messages')
        .set({ body: '', deleted_at: new Date(), mentions_everyone: false })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.deleteFrom('message_mentions').where('message_id', '=', id).execute();
      await trx.deleteFrom('reactions').where('message_id', '=', id).execute();
      // Its files are collected later (files/gc.ts).
      await trx.deleteFrom('attachments').where('message_id', '=', id).execute();
      await trx.deleteFrom('message_links').where('message_id', '=', id).execute();
      const [message] = await hydrateMessages(trx, [deleted]);
      if (!message) throw new Error('message vanished');
      await appendEvent(trx, { type: 'message_updated', message });
    });
    return reply.code(204).send();
  });

  // ---- reactions -----------------------------------------------------------------------------

  app.put('/messages/:id/reactions/:emoji', { preHandler: requireAuth }, async (request, reply) => {
    const { id, emoji } = parseRequest(ReactionParams, request.params, 'params');
    const { userId } = auth(request);
    await commit(async (trx) => {
      const message = await trx
        .selectFrom('messages')
        .select(['room_id', 'deleted_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!message || message.deleted_at) throw noMessage();
      const room = await roomFor(trx, message.room_id);
      if (room.archived_at) throw archived();
      const added = await trx
        .insertInto('reactions')
        .values({ message_id: id, user_id: userId, emoji })
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst();
      if ((added.numInsertedOrUpdatedRows ?? 0n) > 0n) {
        await appendEvent(trx, {
          type: 'reaction_added',
          roomId: message.room_id,
          messageId: id,
          userId,
          emoji,
        });
      }
    });
    return reply.code(204).send();
  });

  app.delete(
    '/messages/:id/reactions/:emoji',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, emoji } = parseRequest(ReactionParams, request.params, 'params');
      const { userId } = auth(request);
      await commit(async (trx) => {
        const message = await trx
          .selectFrom('messages')
          .select('room_id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!message) throw noMessage();
        const removed = await trx
          .deleteFrom('reactions')
          .where('message_id', '=', id)
          .where('user_id', '=', userId)
          .where('emoji', '=', emoji)
          .executeTakeFirst();
        if (removed.numDeletedRows > 0n) {
          await appendEvent(trx, {
            type: 'reaction_removed',
            roomId: message.room_id,
            messageId: id,
            userId,
            emoji,
          });
        }
      });
      return reply.code(204).send();
    },
  );

  // ---- read state ----------------------------------------------------------------------------

  /** How this member hears about the room (A28); their other devices follow at once. */
  app.put('/rooms/:id/prefs', { preHandler: requireAuth }, async (request): Promise<RoomPrefs> => {
    const { id: roomId } = parseRequest(IdParam, request.params, 'params');
    const prefs = parseRequest(RoomPrefs, request.body, 'body');
    const { userId } = auth(request);
    await roomFor(db, roomId);
    const values = {
      notify_level: prefs.notify,
      sound_on_message: prefs.sound,
      hangout_start_alerts: prefs.hangoutAlerts,
      favorite: prefs.favorite,
    };
    await db
      .insertInto('room_user_prefs')
      .values({ room_id: roomId, user_id: userId, ...values })
      .onConflict((oc) => oc.columns(['room_id', 'user_id']).doUpdateSet(values))
      .execute();
    hub.sendToUser(userId, { type: 'room_prefs', roomId, prefs });
    return prefs;
  });

  /** Unread badges only; never shown to others (A22: no read receipts). */
  app.post('/rooms/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const { id: roomId } = parseRequest(IdParam, request.params, 'params');
    const { messageId } = parseRequest(MarkReadRequest, request.body, 'body');
    const { userId } = auth(request);
    const message = await db
      .selectFrom('messages')
      .select('id')
      .where('id', '=', messageId)
      .where('room_id', '=', roomId)
      .executeTakeFirst();
    if (!message) throw noMessage();
    if (await advanceReadMarker(db, roomId, userId, messageId))
      sendReadState(userId, roomId, messageId);
    return reply.code(204).send();
  });
}
