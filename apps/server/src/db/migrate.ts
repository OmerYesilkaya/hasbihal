import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import {
  Migrator,
  type Migration,
  type MigrationProvider,
  type MigrationResultSet,
} from 'kysely/migration';

export const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

/** Migration files are named `0001_create_users.ts`: a 4-digit order, then a snake_case name. */
const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.ts$/;

/**
 * Loads migrations from a folder. Kysely's FileMigrationProvider imports by plain path, which
 * fails for Windows paths; this one imports through file URLs and ignores non-migration files.
 */
export class FolderMigrationProvider implements MigrationProvider {
  readonly #folder: string;

  constructor(folder: string) {
    this.#folder = folder;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    for (const file of (await readdir(this.#folder)).sort()) {
      const name = MIGRATION_FILE.exec(file)?.[1];
      if (!name) continue;
      const module = (await import(
        pathToFileURL(path.join(this.#folder, file)).href
      )) as Partial<Migration>;
      if (typeof module.up !== 'function')
        throw new Error(`Migration ${file} has no exported up()`);
      migrations[name] = { up: module.up, ...(module.down ? { down: module.down } : {}) };
    }
    return migrations;
  }
}

export function createMigrator<DB>(db: Kysely<DB>, folder: string = MIGRATIONS_DIR): Migrator {
  return new Migrator({ db, provider: new FolderMigrationProvider(folder) });
}

/** Applies all pending migrations, or throws with the name of the one that failed. */
export async function migrateToLatest<DB>(
  db: Kysely<DB>,
  folder?: string,
): Promise<MigrationResultSet> {
  return assertMigrated(await createMigrator(db, folder).migrateToLatest());
}

export function assertMigrated(result: MigrationResultSet): MigrationResultSet {
  if (result.error) {
    const failed = result.results?.find((r) => r.status === 'Error')?.migrationName ?? 'unknown';
    throw new Error(`Migration ${failed} failed`, { cause: result.error });
  }
  return result;
}
