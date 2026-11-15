// The first admin (DECISIONS A52): `pnpm --filter @hasbihal/server create-admin-invite` prints a
// single-use hasbihal:// link that signs up an admin. Also how a lost last admin gets back in.
import { createInvite } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { migrateToLatest } from '../db/migrate.ts';

const ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const db = createDatabase(loadConfig().databaseUrl);
try {
  await migrateToLatest(db);
  const invite = await createInvite(db, 'admin', null, ADMIN_INVITE_TTL_MS);
  console.log(`Admin invite (single use, expires ${invite.expiresAt}):\n\n  ${invite.url}\n`);
  console.log(
    'Open it on the computer where Hasbihal is installed, or paste the token on the sign-up screen:',
  );
  console.log(`\n  ${invite.token}\n`);
} finally {
  await db.destroy();
}
