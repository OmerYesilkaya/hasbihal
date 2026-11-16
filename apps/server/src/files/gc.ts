import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.ts';
import type { FileStore } from './store.ts';

/** An upload has this long to be attached to a message before it counts as abandoned. */
export const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Removes files nothing points at any more (ARCHITECTURE §3.6): uploads never sent, files of
 * deleted messages, replaced profile photos. Returns how many went.
 */
export async function collectOrphanFiles(
  db: Kysely<Database>,
  store: FileStore,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_AFTER_MS);
  const orphans = await db
    .deleteFrom('files')
    .where('created_at', '<', cutoff)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('attachments')
            .select(sql`1`.as('one'))
            .whereRef('attachments.file_id', '=', 'files.id'),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('users')
            .select(sql`1`.as('one'))
            .whereRef('users.avatar_file_id', '=', 'files.id'),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('link_previews')
            .select(sql`1`.as('one'))
            .whereRef('link_previews.image_file_id', '=', 'files.id'),
        ),
      ),
    )
    .returning(['storage_key', 'thumbnail_key'])
    .execute();
  for (const file of orphans) {
    await store.remove(file.storage_key).catch(() => undefined);
    if (file.thumbnail_key) await store.remove(file.thumbnail_key).catch(() => undefined);
  }
  return orphans.length;
}
