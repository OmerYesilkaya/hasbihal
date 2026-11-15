import { sql, type Kysely } from 'kysely';

// Rooms and messages (ARCHITECTURE §3.3). Messages are ordered by server time, then id: the id is
// made by the client (for idempotent sends), so its embedded timestamp follows the client's clock.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('rooms')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().check(sql`char_length(name) between 1 and 50`))
    .addColumn('topic', 'text', (c) => c.check(sql`char_length(topic) between 1 and 200`))
    .addColumn('position', 'integer', (c) => c.notNull())
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('archived_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('messages')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('room_id', 'uuid', (c) => c.notNull().references('rooms.id').onDelete('cascade'))
    // Users are never deleted, only marked removed: their messages stay (A42).
    .addColumn('author_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('body', 'text', (c) => c.notNull().check(sql`char_length(body) <= 4000`))
    .addColumn('reply_to_id', 'uuid', (c) => c.references('messages.id').onDelete('set null'))
    .addColumn('mentions_everyone', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('edited_at', 'timestamptz')
    .addColumn('deleted_at', 'timestamptz')
    .execute();
  await db.schema
    .createIndex('messages_room_order_idx')
    .on('messages')
    .columns(['room_id', 'created_at', 'id'])
    .execute();

  await db.schema
    .createTable('message_mentions')
    .addColumn('message_id', 'uuid', (c) =>
      c.notNull().references('messages.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addPrimaryKeyConstraint('message_mentions_pk', ['message_id', 'user_id'])
    .execute();
  await db.schema
    .createIndex('message_mentions_user_idx')
    .on('message_mentions')
    .column('user_id')
    .execute();

  await db.schema
    .createTable('reactions')
    .addColumn('message_id', 'uuid', (c) =>
      c.notNull().references('messages.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('emoji', 'text', (c) => c.notNull().check(sql`char_length(emoji) <= 32`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('reactions_pk', ['message_id', 'user_id', 'emoji'])
    .execute();

  await db.schema
    .createTable('room_user_prefs')
    .addColumn('room_id', 'uuid', (c) => c.notNull().references('rooms.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('notify_level', 'text', (c) =>
      c
        .notNull()
        .defaultTo('mentions')
        .check(sql`notify_level in ('mentions', 'all', 'muted')`),
    )
    .addColumn('sound_on_message', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('hangout_start_alerts', 'boolean', (c) => c.notNull().defaultTo(true))
    // Drives unread badges only; never shown to others (A22: no read receipts).
    .addColumn('last_read_message_id', 'uuid', (c) =>
      c.references('messages.id').onDelete('set null'),
    )
    .addPrimaryKeyConstraint('room_user_prefs_pk', ['room_id', 'user_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['room_user_prefs', 'reactions', 'message_mentions', 'messages', 'rooms']) {
    await db.schema.dropTable(table).execute();
  }
}
