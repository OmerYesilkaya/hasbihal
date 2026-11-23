// Gives a member made before Google sign-in their Google address (DECISIONS A25):
//   pnpm --filter @hasbihal/server set-email <username> <address>
// Their account is linked to that Google account the first time they sign in with it.
import { Email, Username } from '@hasbihal/protocol';
import { isUniqueViolation } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { migrateToLatest } from '../db/migrate.ts';

const [rawUsername, rawEmail] = process.argv.slice(2);
const username = Username.safeParse(rawUsername);
const email = Email.safeParse(rawEmail);
if (!username.success || !email.success) {
  console.error('Usage: set-email <username> <google address>');
  process.exit(1);
}

const db = createDatabase(loadConfig().databaseUrl);
try {
  await migrateToLatest(db);
  const updated = await db
    .updateTable('users')
    .set({ email: email.data })
    .where('username', '=', username.data)
    .where('removed_at', 'is', null)
    // A linked account follows its Google account; changing its address here would mislead.
    .where('google_sub', 'is', null)
    .returning('display_name')
    .executeTakeFirst()
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'users_email_key')) {
        console.error(`${email.data} is already another member's address.`);
        process.exit(1);
      }
      throw error;
    });
  if (!updated) {
    console.error(`No member @${username.data} without a linked Google account.`);
    process.exitCode = 1;
  } else {
    await db.deleteFrom('allowed_emails').where('email', '=', email.data).execute();
    console.log(`@${username.data} (${updated.display_name}) signs in as ${email.data}.`);
  }
} finally {
  await db.destroy();
}
