import { sql, type Kysely } from 'kysely';

// Durable events for catch-up after a reconnect (ARCHITECTURE §5.3). `seq` is global and only
// grows; events older than the retention period are pruned.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('event_log')
    .addColumn('seq', 'bigserial', (c) => c.primaryKey())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('payload', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('event_log_created_at_idx')
    .on('event_log')
    .column('created_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_log').execute();
}
