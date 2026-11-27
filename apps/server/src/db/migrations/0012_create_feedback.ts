import { sql, type Kysely } from 'kysely';

// Feedback sent from the app (DECISIONS A56). Kept here first, so nothing is lost while GitHub
// is unreachable; a job then opens the public issue and records which one it is.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('feedback')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    // Who sent it: for the owner only, never published. Null once they are gone.
    .addColumn('author_id', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('bug', 'idea', 'other')`))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('diagnostics', 'jsonb')
    // Set once the issue exists; null while it waits (or if publishing is off).
    .addColumn('issue_number', 'integer')
    .addColumn('issue_url', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  // For the per-member limit: their recent feedback.
  await db.schema
    .createIndex('feedback_author_created_idx')
    .on('feedback')
    .columns(['author_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('feedback').execute();
}
