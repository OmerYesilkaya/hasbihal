import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDatabase, type Db } from '../src/db/database.ts';
import { TEMPLATE_DATABASE, withDatabase } from './urls.ts';

export interface TestDatabase {
  db: Db;
  url: string;
  /** Closes the connections and drops the database. */
  drop(): Promise<void>;
}

async function admin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('postgresUrl') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * A fresh, fully migrated database for one test file (copied from the template made in
 * global-setup.ts). Call it in `beforeAll` and `drop()` it in `afterAll`.
 */
export async function createTestDatabase(options: { empty?: boolean } = {}): Promise<TestDatabase> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  // `empty`: no migrations applied, for testing the migrator itself.
  const template = options.empty ? 'template0' : TEMPLATE_DATABASE;
  await admin((c) => c.query(`CREATE DATABASE ${name} TEMPLATE ${template}`));
  const url = withDatabase(inject('postgresUrl'), name);
  const db = createDatabase(url);
  return {
    db,
    url,
    async drop() {
      await db.destroy();
      await admin((c) => c.query(`DROP DATABASE ${name} WITH (FORCE)`));
    },
  };
}
