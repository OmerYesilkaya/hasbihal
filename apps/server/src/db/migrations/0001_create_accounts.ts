import { sql, type Kysely } from 'kysely';

// Accounts and sessions (ARCHITECTURE §3.3, §9). Tokens are stored only as SHA-256 hashes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('username', 'text', (c) =>
      c
        .notNull()
        .unique()
        .check(sql`username ~ '^[a-z0-9._]{3,20}$'`),
    )
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('avatar_color', 'smallint', (c) =>
      c.notNull().check(sql`avatar_color between 0 and 7`),
    )
    .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('admin', 'member')`))
    .addColumn('presence_mode', 'text', (c) =>
      c
        .notNull()
        .defaultTo('available')
        .check(sql`presence_mode in ('available', 'busy')`),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('removed_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('credentials')
    .addColumn('user_id', 'uuid', (c) => c.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('password_changed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('refresh_token_hash', 'bytea', (c) => c.notNull())
    .addColumn('device_name', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('sessions_user_id_idx').on('sessions').column('user_id').execute();

  await db.schema
    .createTable('invites')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('token_hash', 'bytea', (c) => c.notNull().unique())
    .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('admin', 'member')`))
    // Null for the first-admin invite, which comes from a server command (A52).
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('used_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('used_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('recovery_links')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'bytea', (c) => c.notNull().unique())
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('used_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['recovery_links', 'invites', 'sessions', 'credentials', 'users']) {
    await db.schema.dropTable(table).execute();
  }
}
