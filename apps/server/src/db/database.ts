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
  // An idle connection can be cut from the other side (PostgreSQL restarting, a network blip).
  // pg then drops it from the pool and emits 'error'; unhandled, that would crash the server.
  // The next query simply opens a new connection, so there's nothing more to do.
  pool.on('error', () => undefined);
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
