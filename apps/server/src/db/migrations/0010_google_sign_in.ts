import { sql, type Kysely } from 'kysely';

// Sign-in with Google instead of passwords, and a list of addresses instead of invite links
// (DECISIONS A25). Members made before this get their address with the `set-email` command, and
// their Google account is linked the first time they sign in with it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    // Lowercase. Matched on first sign-in only; after that the account is found by `google_sub`.
    .addColumn('email', 'text', (c) => c.unique().check(sql`email = lower(email)`))
    // Google's permanent id for the account (the ID token's `sub`): addresses can change.
    .addColumn('google_sub', 'text', (c) => c.unique())
    .execute();

  await db.schema
    .createTable('allowed_emails')
    .addColumn('email', 'text', (c) => c.primaryKey().check(sql`email = lower(email)`))
    .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('admin', 'member')`))
    // Null when added by a server command, e.g. the first admin.
    .addColumn('added_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('added_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('access_requests')
    .addColumn('email', 'text', (c) => c.primaryKey().check(sql`email = lower(email)`))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('requested_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Passwords, invite links, and recovery links are gone with nothing to replace them.
  for (const table of ['recovery_links', 'invites', 'credentials']) {
    await db.schema.dropTable(table).execute();
  }
}
