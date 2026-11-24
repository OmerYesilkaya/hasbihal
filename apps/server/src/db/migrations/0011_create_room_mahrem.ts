import { sql, type Kysely } from 'kysely';

// Mahrem rooms (DECISIONS A55): who may join a room's call without knocking. A room is Mahrem
// while it has rows here; deleting the last one makes it open again.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('room_mahrem')
    .addColumn('room_id', 'uuid', (c) => c.notNull().references('rooms.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    // Null once the one who added them is gone; kept for "who added whom".
    .addColumn('added_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('added_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('room_mahrem_pk', ['room_id', 'user_id'])
    .execute();
  await db.schema.createIndex('room_mahrem_user_idx').on('room_mahrem').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('room_mahrem').execute();
}
