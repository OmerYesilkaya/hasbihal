import type { FastifyInstance } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { newId } from '@hasbihal/core';
import {
  EVENT_WINDOW_MAX_DAYS,
  EventWindowQuery,
  Id,
  OccurrenceChange,
  RsvpRequest,
  SaveEventRequest,
  type EventWindow,
  type RoomEvent,
} from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { appendEvent } from '../gateway/events.ts';
import type { GatewayHub } from '../gateway/hub.ts';
import { toRRule } from './recurrence.ts';
import {
  inviteesOf,
  isScheduledStart,
  occurrencesIn,
  scheduleReminder,
  toRoomEvent,
} from './service.ts';

const EventParams = z.object({ id: Id });
const OccurrenceParams = z.object({ id: Id, start: z.iso.datetime() });

const notFound = () => new AppError(404, 'not_found', 'No such event.');

/**
 * Events in rooms (ARCHITECTURE §8): admins create and change them (A16), everyone sees them and
 * answers for themselves.
 */
export function registerEvents(
  app: FastifyInstance,
  deps: {
    db: Kysely<Database>;
    hub: GatewayHub;
    guards: AuthGuards;
    /** Wakes the job queue after a commit that queued a reminder. */
    jobsQueued: () => void;
  },
): void {
  const { db, hub, guards, jobsQueued } = deps;
  const { requireAuth, requireAdmin, auth } = guards;

  /** A change, and the "reload events" signal for its room, in one transaction. */
  const commit = async <T>(
    roomId: string,
    change: (trx: Transaction<Database>) => Promise<T>,
  ): Promise<T> => {
    const result = await db.transaction().execute(async (trx) => {
      const value = await change(trx);
      await appendEvent(trx, { type: 'events_changed', roomId });
      return value;
    });
    hub.eventsCommitted();
    jobsQueued();
    return result;
  };

  const loadEvent = async (trx: Kysely<Database>, id: string) => {
    const event = await trx
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!event) throw notFound();
    return event;
  };

  /** The room must exist and be open; invitees must be current members. */
  const validate = async (trx: Kysely<Database>, body: z.infer<typeof SaveEventRequest>) => {
    const room = await trx
      .selectFrom('rooms')
      .select('archived_at')
      .where('id', '=', body.roomId)
      .executeTakeFirst();
    if (!room) throw new AppError(404, 'not_found', 'No such room.');
    if (room.archived_at) throw new AppError(409, 'conflict', 'This room is archived.');
    const invitees = [...new Set(body.inviteeIds)];
    if (invitees.length) {
      const found = await trx
        .selectFrom('users')
        .select('id')
        .where('id', 'in', invitees)
        .where('removed_at', 'is', null)
        .execute();
      if (found.length !== invitees.length)
        throw new AppError(400, 'validation_failed', 'An invitee is not a member.');
    }
    return invitees;
  };

  const values = (body: z.infer<typeof SaveEventRequest>) => ({
    room_id: body.roomId,
    title: body.title,
    // An emptied description is no description.
    description: body.description?.length ? body.description : null,
    starts_at: new Date(body.startsAt),
    duration_min: body.durationMin,
    rrule: body.recurrence ? toRRule(body.recurrence) : null,
    reminder_offset_min: body.reminderMin,
  });

  // ---- reading ---------------------------------------------------------------------------------

  app.get('/events', { preHandler: requireAuth }, async (request): Promise<EventWindow> => {
    const query = parseRequest(EventWindowQuery, request.query, 'query');
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from || to.getTime() - from.getTime() > EVENT_WINDOW_MAX_DAYS * 86_400_000)
      throw new AppError(400, 'validation_failed', 'The window is empty or too long.');
    let rows = db.selectFrom('events').selectAll();
    if (query.roomId) rows = rows.where('room_id', '=', query.roomId);
    // Recurring events may reach any window; one-off events only their own (a day's slack
    // covers the longest event).
    rows = rows.where((eb) =>
      eb.or([
        eb('rrule', 'is not', null),
        eb.and([
          eb('starts_at', '<', to),
          eb('starts_at', '>=', new Date(from.getTime() - 86_400_000)),
        ]),
        // A one-off moved into the window.
        eb.exists(
          eb
            .selectFrom('event_exceptions')
            .select('event_exceptions.event_id')
            .whereRef('event_exceptions.event_id', '=', 'events.id')
            .where('event_exceptions.new_starts_at', '<', to)
            .where('event_exceptions.new_starts_at', '>=', new Date(from.getTime() - 86_400_000)),
        ),
      ]),
    );
    const events = await rows.execute();
    const occurrences = await occurrencesIn(db, events, from, to);
    const used = new Set(occurrences.map((o) => o.eventId));
    const shown = events.filter((e) => used.has(e.id));
    const invitees = await inviteesOf(
      db,
      shown.map((e) => e.id),
    );
    return {
      events: shown.map((e) => toRoomEvent(e, invitees.get(e.id) ?? [])),
      occurrences,
    };
  });

  // ---- admins: the events themselves (A16) -------------------------------------------------------

  app.post('/events', { preHandler: requireAdmin }, async (request, reply): Promise<RoomEvent> => {
    const body = parseRequest(SaveEventRequest, request.body, 'body');
    const { userId } = auth(request);
    const event = await commit(body.roomId, async (trx) => {
      const invitees = await validate(trx, body);
      const row = await trx
        .insertInto('events')
        .values({ id: newId(), ...values(body), created_by: userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (invitees.length)
        await trx
          .insertInto('event_invitees')
          .values(invitees.map((user_id) => ({ event_id: row.id, user_id })))
          .execute();
      await scheduleReminder(trx, row);
      return toRoomEvent(row, invitees);
    });
    void reply.code(201);
    return event;
  });

  app.put('/events/:id', { preHandler: requireAdmin }, async (request): Promise<RoomEvent> => {
    const { id } = parseRequest(EventParams, request.params, 'params');
    const body = parseRequest(SaveEventRequest, request.body, 'body');
    const existing = await loadEvent(db, id);
    if (existing.room_id !== body.roomId)
      throw new AppError(400, 'validation_failed', 'An event stays in its room.');
    return commit(body.roomId, async (trx) => {
      const invitees = await validate(trx, body);
      const row = await trx
        .updateTable('events')
        .set((eb) => ({ ...values(body), revision: eb('revision', '+', 1) }))
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.deleteFrom('event_invitees').where('event_id', '=', id).execute();
      if (invitees.length)
        await trx
          .insertInto('event_invitees')
          .values(invitees.map((user_id) => ({ event_id: id, user_id })))
          .execute();
      await scheduleReminder(trx, row);
      return toRoomEvent(row, invitees);
    });
  });

  app.delete('/events/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = parseRequest(EventParams, request.params, 'params');
    const event = await loadEvent(db, id);
    // Its queued reminder finds no event and does nothing.
    await commit(event.room_id, (trx) => trx.deleteFrom('events').where('id', '=', id).execute());
    return reply.code(204).send();
  });

  // ---- admins: single occurrences (A16) ----------------------------------------------------------

  /** Loads the event and checks that `start` is one of its occurrences. */
  const occurrence = async (trx: Kysely<Database>, id: string, start: string) => {
    const event = await loadEvent(trx, id);
    const at = new Date(start);
    if (!isScheduledStart(event, at)) throw new AppError(404, 'not_found', 'No such occurrence.');
    return { event, at };
  };

  /** After a skip or move: the next reminder may be a different one. */
  const reschedule = async (trx: Kysely<Database>, id: string) => {
    const row = await trx
      .updateTable('events')
      .set((eb) => ({ revision: eb('revision', '+', 1) }))
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await scheduleReminder(trx, row);
  };

  app.put(
    '/events/:id/occurrences/:start',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id, start } = parseRequest(OccurrenceParams, request.params, 'params');
      const change = parseRequest(OccurrenceChange, request.body, 'body');
      const { event, at } = await occurrence(db, id, start);
      await commit(event.room_id, async (trx) => {
        const values = {
          kind: change.kind,
          new_starts_at: change.kind === 'moved' ? new Date(change.startsAt) : null,
        };
        await trx
          .insertInto('event_exceptions')
          .values({ event_id: id, occurrence_start: at, ...values })
          .onConflict((oc) => oc.columns(['event_id', 'occurrence_start']).doUpdateSet(values))
          .execute();
        await reschedule(trx, id);
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    '/events/:id/occurrences/:start',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id, start } = parseRequest(OccurrenceParams, request.params, 'params');
      const { event, at } = await occurrence(db, id, start);
      await commit(event.room_id, async (trx) => {
        await trx
          .deleteFrom('event_exceptions')
          .where('event_id', '=', id)
          .where('occurrence_start', '=', at)
          .execute();
        await reschedule(trx, id);
      });
      return reply.code(204).send();
    },
  );

  // ---- everyone: RSVPs, per occurrence (ARCHITECTURE §8) ------------------------------------------

  app.put(
    '/events/:id/occurrences/:start/rsvp',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, start } = parseRequest(OccurrenceParams, request.params, 'params');
      const { response } = parseRequest(RsvpRequest, request.body, 'body');
      const { userId } = auth(request);
      const { event, at } = await occurrence(db, id, start);
      await commit(event.room_id, (trx) =>
        trx
          .insertInto('event_rsvps')
          .values({ event_id: id, occurrence_start: at, user_id: userId, response })
          .onConflict((oc) =>
            oc
              .columns(['event_id', 'occurrence_start', 'user_id'])
              .doUpdateSet({ response, updated_at: new Date() }),
          )
          .execute(),
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    '/events/:id/occurrences/:start/rsvp',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, start } = parseRequest(OccurrenceParams, request.params, 'params');
      const { userId } = auth(request);
      const { event, at } = await occurrence(db, id, start);
      await commit(event.room_id, (trx) =>
        trx
          .deleteFrom('event_rsvps')
          .where('event_id', '=', id)
          .where('occurrence_start', '=', at)
          .where('user_id', '=', userId)
          .execute(),
      );
      return reply.code(204).send();
    },
  );
}
