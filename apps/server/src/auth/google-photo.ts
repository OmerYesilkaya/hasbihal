import type { Kysely } from 'kysely';
import { z } from 'zod';
import { AVATAR_MAX_BYTES } from '@hasbihal/protocol';
import type { Database } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { enqueueJob, type JobHandler } from '../jobs/queue.ts';
import { FetchError, type Fetcher } from '../previews/fetcher.ts';
import { setAvatarIfNone, type ProfileStore } from '../profile/avatar.ts';

export const GOOGLE_PHOTO_JOB = 'google_photo';

/**
 * Google photo addresses end in a size (`=s96-c`, a 96 px crop). Ask for the size we store, so
 * the photo isn't scaled up from a thumbnail.
 */
export function photoUrlAtSize(url: string, size = 256): string {
  return url.replace(/=s\d+(-c)?$/, `=s${String(size)}-c`);
}

/** Queued with the sign-in that creates or links an account, in its transaction. */
export const enqueueGooglePhoto = (db: Kysely<Database>, userId: string, url: string) =>
  enqueueJob(db, GOOGLE_PHOTO_JOB, { userId, url: photoUrlAtSize(url) });

/**
 * The member's Google photo becomes their profile photo (A25, A40), unless they have one. Kept as
 * our own copy, fetched like link previews (ARCHITECTURE §7): Google's address isn't permanent.
 */
export function googlePhotoJob(deps: ProfileStore & { fetcher: Fetcher }): JobHandler {
  return async (payload) => {
    const { userId, url } = z.object({ userId: z.string(), url: z.string() }).parse(payload);
    let body: Buffer;
    try {
      ({ body } = await deps.fetcher.fetch(url, {
        accept: ['image/'],
        maxBytes: AVATAR_MAX_BYTES,
        truncate: false,
      }));
    } catch (error) {
      // Gone, blocked, or too large: initials it is. Only a passing failure is retried.
      if (!(error instanceof FetchError) || error.retryable) throw error;
      return;
    }
    await setAvatarIfNone(deps, userId, body, 'google-photo').catch((error: unknown) => {
      // Not an image we can use: same as no photo.
      if (!(error instanceof AppError)) throw error;
    });
  };
}
