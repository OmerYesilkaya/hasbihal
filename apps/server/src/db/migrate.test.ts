import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { createMigrator, migrateToLatest } from './migrate.ts';

let testDb: TestDatabase;
let folder: string;

const migration = (table: string) => `
import { sql } from 'kysely';
export async function up(db) { await sql\`create table ${table} (id int primary key)\`.execute(db); }
export async function down(db) { await sql\`drop table ${table}\`.execute(db); }
`;

beforeAll(async () => {
  testDb = await createTestDatabase({ empty: true });
  folder = await mkdtemp(path.join(tmpdir(), 'hasbihal-migrations-'));
  // Written out of order on purpose; the 4-digit prefix decides the order.
  await writeFile(path.join(folder, '0002_create_b.ts'), migration('b'));
  await writeFile(path.join(folder, '0001_create_a.ts'), migration('a'));
  await writeFile(path.join(folder, 'README.md'), '# not a migration');
  await writeFile(path.join(folder, 'helper.ts'), 'export const notAMigration = true;');
});

afterAll(async () => {
  await testDb.drop();
  await rm(folder, { recursive: true, force: true });
});

const tables = async () =>
  (
    await sql<{
      tablename: string;
    }>`select tablename from pg_tables where schemaname = 'public' and tablename in ('a', 'b') order by tablename`.execute(
      testDb.db,
    )
  ).rows.map((r) => r.tablename);

describe('migrations', () => {
  it('applies only correctly named files, in order', async () => {
    const { results } = await migrateToLatest(testDb.db, folder);
    expect(results?.map((r) => r.migrationName)).toEqual(['0001_create_a', '0002_create_b']);
    expect(await tables()).toEqual(['a', 'b']);
  });

  it('is a no-op when already up to date, and can step down', async () => {
    expect((await migrateToLatest(testDb.db, folder)).results).toEqual([]);
    await createMigrator(testDb.db, folder).migrateDown();
    expect(await tables()).toEqual(['a']);
  });

  it('reports which migration failed', async () => {
    await writeFile(
      path.join(folder, '0003_broken.ts'),
      "export async function up() { throw new Error('boom'); }",
    );
    await expect(migrateToLatest(testDb.db, folder)).rejects.toThrow(
      'Migration 0003_broken failed',
    );
  });
});
