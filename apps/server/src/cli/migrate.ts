// Development helper: `pnpm --filter @hasbihal/server migrate <latest|down|status>`.
// The server itself migrates to latest on startup.
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { assertMigrated, createMigrator } from '../db/migrate.ts';

const command = process.argv[2] ?? 'status';
const db = createDatabase(loadConfig().databaseUrl);
const migrator = createMigrator(db);

try {
  if (command === 'latest' || command === 'down') {
    const { results } = assertMigrated(
      command === 'latest' ? await migrator.migrateToLatest() : await migrator.migrateDown(),
    );
    if (!results?.length) console.log('Nothing to do.');
    for (const r of results ?? [])
      console.log(`${r.direction === 'Up' ? '↑' : '↓'} ${r.migrationName}: ${r.status}`);
  } else if (command === 'status') {
    const migrations = await migrator.getMigrations();
    if (!migrations.length) console.log('No migrations.');
    for (const m of migrations) console.log(`${m.executedAt ? '✓' : '·'} ${m.name}`);
  } else {
    console.error(`Unknown command "${command}". Use latest, down, or status.`);
    process.exitCode = 1;
  }
} finally {
  await db.destroy();
}
