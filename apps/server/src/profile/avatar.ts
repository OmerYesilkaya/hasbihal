import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { newId } from '@hasbihal/core';
import type { User } from '@hasbihal/protocol';
import { toUser } from '../auth/sessions.ts';
import type { Database } from '../db/schema.ts';
import { processAvatar } from '../files/images.ts';
import { storageKey, type FileStore } from '../files/store.ts';
import { appendEvent } from '../gateway/events.ts';
import type { EventNotifier } from '../gateway/hub.ts';

export interface ProfileStore {
  db: Kysely<Database>;
  store: FileStore;
  hub: EventNotifier;
}

/** Applies a change to the user and announces the result to everyone. */
export async function updateUser(
  { db, hub }: ProfileStore,
  userId: string,
  change: { display_name?: string; avatar_file_id?: string | null },
): Promise<User> {
  const user = await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('users')
      .set(change)
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    const updated = toUser(row);
    await appendEvent(trx, { type: 'member_updated', user: updated });
    return updated;
  });
  hub.eventsCommitted();
  return user;
}

/** Removes a replaced photo: its row and its bytes. Best effort; an orphan only costs disk. */
export async function dropFile({ db, store }: ProfileStore, fileId: string | null): Promise<void> {
  if (!fileId) return;
  const file = await db
    .deleteFrom('files')
    .where('id', '=', fileId)
    .returning('storage_key')
    .executeTakeFirst();
  if (file) await store.remove(file.storage_key).catch(() => undefined);
}

/** Stores a picture as a 256 px WebP file (A40) and returns its file id. */
async function storePhoto(
  { db, store }: ProfileStore,
  userId: string,
  input: Buffer,
  originalName: string,
): Promise<string> {
  const image = await processAvatar(input);
  const id = newId();
  const key = storageKey(id, 'webp');
  await store.put(key, image.data);
  await db
    .insertInto('files')
    .values({
      id,
      uploader_id: userId,
      kind: 'image',
      original_name: originalName.slice(0, 255) || 'avatar',
      mime: 'image/webp',
      size_bytes: image.data.length,
      sha256: createHash('sha256').update(image.data).digest(),
      storage_key: key,
      width: image.width,
      height: image.height,
    })
    .execute();
  return id;
}

const currentPhoto = async ({ db }: ProfileStore, userId: string) =>
  (
    await db
      .selectFrom('users')
      .select('avatar_file_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow()
  ).avatar_file_id;

/** Makes a picture the member's photo, announced to everyone; the old photo is removed. */
export async function setAvatar(
  deps: ProfileStore,
  userId: string,
  input: Buffer,
  originalName: string,
): Promise<User> {
  const id = await storePhoto(deps, userId, input, originalName);
  const previous = await currentPhoto(deps, userId);
  const user = await updateUser(deps, userId, { avatar_file_id: id });
  await dropFile(deps, previous);
  return user;
}

/**
 * `setAvatar` for a member without a photo, else nothing (undefined): for the Google photo, which
 * must never replace one they chose.
 */
export async function setAvatarIfNone(
  deps: ProfileStore,
  userId: string,
  input: Buffer,
  originalName: string,
): Promise<User | undefined> {
  if (await currentPhoto(deps, userId)) return undefined;
  const id = await storePhoto(deps, userId, input, originalName);
  // Checked again in the update itself: a photo uploaded meanwhile wins.
  const user = await deps.db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('users')
      .set({ avatar_file_id: id })
      .where('id', '=', userId)
      .where('avatar_file_id', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!row) return undefined;
    const updated = toUser(row);
    await appendEvent(trx, { type: 'member_updated', user: updated });
    return updated;
  });
  if (!user) {
    await dropFile(deps, id);
    return undefined;
  }
  deps.hub.eventsCommitted();
  return user;
}
