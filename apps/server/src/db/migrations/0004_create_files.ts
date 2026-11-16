import { sql, type Kysely } from 'kysely';

// Stored files (ARCHITECTURE §3.3, DECISIONS A54): avatars now, attachments in M4. The bytes live in
// the file store under `storage_key`; this row says what they are and who uploaded them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('files')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('uploader_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('kind', 'text', (c) =>
      c.notNull().check(sql`kind in ('image', 'video', 'audio', 'voice', 'other')`),
    )
    .addColumn('original_name', 'text', (c) => c.notNull())
    .addColumn('mime', 'text', (c) => c.notNull())
    .addColumn('size_bytes', 'bigint', (c) => c.notNull())
    .addColumn('sha256', 'bytea', (c) => c.notNull())
    .addColumn('storage_key', 'text', (c) => c.notNull().unique())
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('duration_ms', 'integer')
    .addColumn('thumbnail_key', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .alterTable('users')
    .addColumn('avatar_file_id', 'uuid', (c) => c.references('files.id').onDelete('set null'))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('avatar_file_id').execute();
  await db.schema.dropTable('files').execute();
}
