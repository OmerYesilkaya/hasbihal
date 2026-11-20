import type { Kysely } from 'kysely';

// A member's favourite rooms, listed first in their sidebar: one more per-member room setting.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('room_user_prefs')
    .addColumn('favorite', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('room_user_prefs').dropColumn('favorite').execute();
}
