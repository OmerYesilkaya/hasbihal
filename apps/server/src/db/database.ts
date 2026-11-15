import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.ts';

export type Db = Kysely<Database>;

export function createDatabase(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Fail fast when PostgreSQL is down, so /health and requests answer instead of hanging.
    connectionTimeoutMillis: 5_000,
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** True when a trivial query succeeds. Used by /health. */
export async function isDatabaseReachable(db: Db): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
