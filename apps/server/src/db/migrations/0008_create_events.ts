import { sql, type Kysely } from 'kysely';

// Events in rooms (ARCHITECTURE §3.3, §8; DECISIONS A15, A16, A17). Occurrences are expanded on
// read and never stored; only exceptions (skipped, moved) and RSVPs name single occurrences, by
// their scheduled start.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('events')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('room_id', 'uuid', (c) => c.notNull().references('rooms.id').onDelete('cascade'))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('starts_at', 'timestamptz', (c) => c.notNull())
    .addColumn('duration_min', 'integer', (c) => c.notNull())
    // RFC 5545 RRULE without DTSTART, read in `tz` wall time; null for a one-off event.
    .addColumn('rrule', 'text')
    .addColumn('tz', 'text', (c) => c.notNull().defaultTo('Europe/Istanbul'))
    .addColumn('reminder_offset_min', 'integer', (c) => c.notNull().defaultTo(10))
    // Bumped on every change: a queued reminder for an older revision does nothing.
    .addColumn('revision', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('events_room').on('events').column('room_id').execute();

  await db.schema
    .createTable('event_invitees')
    .addColumn('event_id', 'uuid', (c) => c.notNull().references('events.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addPrimaryKeyConstraint('event_invitees_pkey', ['event_id', 'user_id'])
    .execute();

  await db.schema
    .createTable('event_exceptions')
    .addColumn('event_id', 'uuid', (c) => c.notNull().references('events.id').onDelete('cascade'))
    .addColumn('occurrence_start', 'timestamptz', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('skipped', 'moved')`))
    .addColumn('new_starts_at', 'timestamptz')
    .addPrimaryKeyConstraint('event_exceptions_pkey', ['event_id', 'occurrence_start'])
    .addCheckConstraint(
      'event_exceptions_moved_has_time',
      sql`(kind = 'moved') = (new_starts_at is not null)`,
    )
    .execute();

  await db.schema
    .createTable('event_rsvps')
    .addColumn('event_id', 'uuid', (c) => c.notNull().references('events.id').onDelete('cascade'))
    .addColumn('occurrence_start', 'timestamptz', (c) => c.notNull())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('response', 'text', (c) => c.notNull().check(sql`response in ('yes', 'no')`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('event_rsvps_pkey', ['event_id', 'occurrence_start', 'user_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_rsvps').execute();
  await db.schema.dropTable('event_exceptions').execute();
  await db.schema.dropTable('event_invitees').execute();
  await db.schema.dropTable('events').execute();
}
