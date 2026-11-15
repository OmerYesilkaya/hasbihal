import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/database.ts';
import { migrateToLatest } from './db/migrate.ts';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);

// A single server instance (A4), so migrating on startup is safe and keeps deployment one step.
const { results } = await migrateToLatest(db);
const app = await buildApp(config, { db });
for (const r of results ?? []) app.log.info({ migration: r.migrationName }, 'migration applied');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => db.destroy())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
