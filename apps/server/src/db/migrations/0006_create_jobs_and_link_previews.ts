import { sql, type Kysely } from 'kysely';

// Background jobs (ARCHITECTURE §3.6) and link previews (§7, DECISIONS A24).
export async function up(db: Kysely<unknown>): Promise<void> {
  // A durable queue: a job is claimed by moving its run_at forward (a lease), and deleted when done.
  await db.schema
    .createTable('jobs')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('payload', 'jsonb', (c) => c.notNull())
    .addColumn('run_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('jobs_run_at').on('jobs').column('run_at').execute();

  // One row per URL, shared by every message that links it (results are cached per URL).
  await db.schema
    .createTable('link_previews')
    .addColumn('url', 'text', (c) => c.primaryKey())
    .addColumn('status', 'text', (c) => c.notNull().check(sql`status in ('pending', 'ok', 'none')`))
    .addColumn('title', 'text')
    .addColumn('description', 'text')
    .addColumn('site_name', 'text')
    .addColumn('image_file_id', 'uuid', (c) => c.references('files.id').onDelete('set null'))
    .addColumn('fetched_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('message_links')
    .addColumn('message_id', 'uuid', (c) =>
      c.notNull().references('messages.id').onDelete('cascade'),
    )
    .addColumn('url', 'text', (c) => c.notNull().references('link_previews.url'))
    .addColumn('position', 'smallint', (c) => c.notNull())
    .addPrimaryKeyConstraint('message_links_pkey', ['message_id', 'position'])
    .execute();
  await db.schema.createIndex('message_links_url').on('message_links').column('url').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('message_links').execute();
  await db.schema.dropTable('link_previews').execute();
  await db.schema.dropTable('jobs').execute();
}
