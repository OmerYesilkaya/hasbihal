import type { Kysely } from 'kysely';

// Files on messages (ARCHITECTURE §3.3, §7; DECISIONS A26). A file is attached at most once.
// Deleting a message removes its links; the files themselves are collected later (files/gc.ts).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('attachments')
    .addColumn('message_id', 'uuid', (c) =>
      c.notNull().references('messages.id').onDelete('cascade'),
    )
    .addColumn('file_id', 'uuid', (c) => c.notNull().unique().references('files.id'))
    .addColumn('position', 'smallint', (c) => c.notNull())
    .addPrimaryKeyConstraint('attachments_pkey', ['message_id', 'position'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('attachments').execute();
}
