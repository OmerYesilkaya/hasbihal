// Lets a Google address in from the server itself (DECISIONS A25, A52):
//   pnpm --filter @hasbihal/server allow-email <address> [--admin]
// How the first admin gets in on a fresh server, and how a lost last admin gets back in.
import { Email, type Role } from '@hasbihal/protocol';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { migrateToLatest } from '../db/migrate.ts';

const args = process.argv.slice(2);
const role: Role = args.includes('--admin') ? 'admin' : 'member';
const email = Email.safeParse(args.find((a) => !a.startsWith('--')));
if (!email.success) {
  console.error('Usage: allow-email <google address> [--admin]');
  process.exit(1);
}

const db = createDatabase(loadConfig().databaseUrl);
try {
  await migrateToLatest(db);
  const member = await db
    .selectFrom('users')
    .select(['id', 'role'])
    .where('email', '=', email.data)
    .where('removed_at', 'is', null)
    .executeTakeFirst();
  if (member) {
    // Already in: make sure an admin is one (a lost last admin), and nothing else.
    if (role === 'admin' && member.role !== 'admin')
      await db.updateTable('users').set({ role }).where('id', '=', member.id).execute();
    console.log(`${email.data} is already a member (${role === 'admin' ? 'admin' : member.role}).`);
  } else {
    await db
      .insertInto('allowed_emails')
      .values({ email: email.data, role, added_by: null })
      .onConflict((oc) => oc.column('email').doUpdateSet({ role }))
      .execute();
    console.log(`${email.data} may now sign in with Google, as ${role}.`);
  }
} finally {
  await db.destroy();
}
