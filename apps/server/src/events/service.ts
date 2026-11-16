import { sql, type Kysely, type Selectable } from 'kysely';
import { z } from 'zod';
import type { Occurrence, RoomEvent } from '@hasbihal/protocol';
import type { Database, EventsTable } from '../db/schema.ts';
import type { GatewayHub } from '../gateway/hub.ts';
import { enqueueJob, type JobHandler } from '../jobs/queue.ts';
import { fromRRule, nextScheduledStart, scheduledStarts } from './recurrence.ts';

export const EVENT_REMINDER_JOB = 'event_reminder';

type EventRow = Selectable<EventsTable>;

export function toRoomEvent(row: EventRow, inviteeIds: string[]): RoomEvent {
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    durationMin: row.duration_min,
    recurrence: row.rrule ? fromRRule(row.rrule) : null,
    reminderMin: row.reminder_offset_min,
    inviteeIds,
    createdBy: row.created_by,
  };
}

export async function inviteesOf(
  db: Kysely<Database>,
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const byEvent = new Map<string, string[]>();
  if (!eventIds.length) return byEvent;
  const rows = await db
    .selectFrom('event_invitees')
    .select(['event_id', 'user_id'])
    .where('event_id', 'in', eventIds)
    .execute();
  for (const r of rows) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r.user_id]);
  return byEvent;
}

/** Whether `start` is one of the event's scheduled starts (what names an occurrence). */
export function isScheduledStart(event: EventRow, start: Date): boolean {
  return scheduledStarts(event, start, new Date(start.getTime() + 1)).some(
    (s) => s.getTime() === start.getTime(),
  );
}

/**
 * The occurrences of these events that overlap [from, to), with skips, moves, and RSVPs applied,
 * in order of when they actually happen.
 */
export async function occurrencesIn(
  db: Kysely<Database>,
  events: EventRow[],
  from: Date,
  to: Date,
): Promise<Occurrence[]> {
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const [exceptions, rsvps] = await Promise.all([
    db.selectFrom('event_exceptions').selectAll().where('event_id', 'in', ids).execute(),
    db
      .selectFrom('event_rsvps')
      .select(['event_id', 'occurrence_start', 'user_id', 'response'])
      .where('event_id', 'in', ids)
      .orderBy('updated_at')
      .execute(),
  ]);
  const key = (eventId: string, start: Date) => `${eventId}@${start.toISOString()}`;
  const exceptionAt = new Map(exceptions.map((x) => [key(x.event_id, x.occurrence_start), x]));

  const result: Occurrence[] = [];
  const add = (event: EventRow, start: Date) => {
    const exception = exceptionAt.get(key(event.id, start));
    const startsAt = exception?.new_starts_at ?? start;
    const endsAt = new Date(startsAt.getTime() + event.duration_min * 60_000);
    if (endsAt <= from || startsAt >= to) return;
    result.push({
      eventId: event.id,
      start: start.toISOString(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      skipped: exception?.kind === 'skipped',
      moved: exception?.kind === 'moved',
      rsvps: rsvps
        .filter((r) => r.event_id === event.id && r.occurrence_start.getTime() === start.getTime())
        .map((r) => ({ userId: r.user_id, response: r.response })),
    });
  };
  for (const event of events) {
    const starts = scheduledStarts(event, from, to);
    for (const start of starts) add(event, start);
    // Moved into the window from a time outside it.
    const seen = new Set(starts.map((s) => s.getTime()));
    for (const x of exceptions)
      if (x.event_id === event.id && x.kind === 'moved' && !seen.has(x.occurrence_start.getTime()))
        add(event, x.occurrence_start);
  }
  return result.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Queues the reminder for the event's next occurrence that hasn't started (ARCHITECTURE §8),
 * honouring skips and moves, in place of any reminder queued before. (A reminder already running
 * when this happens checks the revision and does nothing.)
 */
export async function scheduleReminder(
  db: Kysely<Database>,
  event: EventRow,
  after: Date | null = null,
  now = new Date(),
): Promise<void> {
  await db
    .deleteFrom('jobs')
    .where('kind', '=', EVENT_REMINDER_JOB)
    .where(sql<string>`payload->>'eventId'`, '=', event.id)
    .execute();
  if (event.reminder_offset_min <= 0) return;
  const exceptions = await db
    .selectFrom('event_exceptions')
    .selectAll()
    .where('event_id', '=', event.id)
    .execute();
  const byStart = new Map(exceptions.map((x) => [x.occurrence_start.getTime(), x]));
  // From a day back: an occurrence moved later may not have started yet.
  let cursor = after ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  for (let i = 0; i < 400; i++) {
    const start = nextScheduledStart(event, cursor);
    if (!start) return;
    cursor = start;
    const exception = byStart.get(start.getTime());
    if (exception?.kind === 'skipped') continue;
    const startsAt = exception?.new_starts_at ?? start;
    if (startsAt <= now) continue;
    const remindAt = new Date(startsAt.getTime() - event.reminder_offset_min * 60_000);
    await enqueueJob(
      db,
      EVENT_REMINDER_JOB,
      { eventId: event.id, revision: event.revision, start: start.toISOString() },
      // Too late for the full lead time (made at the last minute): remind now.
      remindAt > now ? remindAt : now,
    );
    return;
  }
}

/** The reminder job: tell invitees who are online (A15), then queue the next one. */
export function eventReminderJob(deps: { db: Kysely<Database>; hub: GatewayHub }): JobHandler {
  const { db, hub } = deps;
  return async (payload) => {
    const job = z
      .object({ eventId: z.string(), revision: z.number(), start: z.iso.datetime() })
      .parse(payload);
    const event = await db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', job.eventId)
      .executeTakeFirst();
    // Deleted, or changed since: a newer reminder was queued with the change.
    if (event?.revision !== job.revision) return;
    const start = new Date(job.start);
    const exception = await db
      .selectFrom('event_exceptions')
      .selectAll()
      .where('event_id', '=', event.id)
      .where('occurrence_start', '=', start)
      .executeTakeFirst();
    if (exception?.kind !== 'skipped') {
      const startsAt = (exception?.new_starts_at ?? start).toISOString();
      const invitees = (await inviteesOf(db, [event.id])).get(event.id) ?? [];
      for (const userId of invitees)
        hub.sendToUser(userId, {
          type: 'event_reminder',
          eventId: event.id,
          roomId: event.room_id,
          title: event.title,
          startsAt,
        });
    }
    await scheduleReminder(db, event, start);
  };
}
