import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { AVATAR_MAX_BYTES, UpdateProfileRequest, type User } from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import type { FileStore } from '../files/store.ts';
import type { GatewayHub } from '../gateway/hub.ts';
import { dropFile, setAvatar, updateUser, type ProfileStore } from './avatar.ts';

export interface ProfileDeps {
  db: Kysely<Database>;
  store: FileStore;
  hub: GatewayHub;
  guards: AuthGuards;
}

/** The profile view (A41): display name and photo (A40). */
export function registerProfile(
  app: FastifyInstance,
  { db, store, hub, guards }: ProfileDeps,
): void {
  const { requireAuth, auth } = guards;
  const profiles: ProfileStore = { db, store, hub };

  app.patch('/me', { preHandler: requireAuth }, async (request): Promise<User> => {
    const { displayName } = parseRequest(UpdateProfileRequest, request.body, 'body');
    return updateUser(profiles, auth(request).userId, { display_name: displayName });
  });

  app.put('/me/avatar', { preHandler: requireAuth }, async (request): Promise<User> => {
    const part = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
    if (!part) throw new AppError(400, 'validation_failed', 'Send the photo as a file.');
    const input = await part.toBuffer().catch(() => {
      throw new AppError(413, 'validation_failed', 'The photo is too large.', [
        { path: ['body', 'file'], message: 'Too large.', code: 'file_too_large' },
      ]);
    });
    return setAvatar(profiles, auth(request).userId, input, part.filename);
  });

  app.delete('/me/avatar', { preHandler: requireAuth }, async (request): Promise<User> => {
    const { userId } = auth(request);
    const previous = await db
      .selectFrom('users')
      .select('avatar_file_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const user = await updateUser(profiles, userId, { avatar_file_id: null });
    await dropFile(profiles, previous.avatar_file_id);
    return user;
  });
}
