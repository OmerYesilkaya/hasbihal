// Vitest global setup: one real PostgreSQL per test run (ARCHITECTURE §11), the same version as
// infra/compose.dev.yml. Migrations run once into a template database; each test file then gets a
// cheap copy of it (see database.ts), so tests are isolated without re-running migrations.
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../src/db/database.ts';
import { migrateToLatest } from '../src/db/migrate.ts';
import { TEMPLATE_DATABASE, withDatabase } from './urls.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URL of the test server's maintenance database. */
    postgresUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17.12').start();
  const adminUrl = container.getConnectionUri();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  await admin.end();

  const template = createDatabase(withDatabase(adminUrl, TEMPLATE_DATABASE));
  await migrateToLatest(template);
  await template.destroy(); // a template can't be copied while connected

  project.provide('postgresUrl', adminUrl);
  return async () => {
    await container.stop();
  };
}
