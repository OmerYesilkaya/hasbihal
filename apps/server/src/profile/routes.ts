import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { newId } from '@hasbihal/core';
import {
  AVATAR_MAX_BYTES,
  ChangePasswordRequest,
  UpdateProfileRequest,
  type User,
} from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/passwords.ts';
import { toUser } from '../auth/sessions.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { processAvatar } from '../files/images.ts';
import { storageKey, type FileStore } from '../files/store.ts';
import { appendEvent } from '../gateway/events.ts';
import type { GatewayHub } from '../gateway/hub.ts';

export interface ProfileDeps {
  db: Kysely<Database>;
  store: FileStore;
  hub: GatewayHub;
  guards: AuthGuards;
}

/** The profile view (A41): display name, photo (A40), and password. */
export function registerProfile(
  app: FastifyInstance,
  { db, store, hub, guards }: ProfileDeps,
): void {
  const { requireAuth, auth } = guards;

  /** Applies a change to the user and announces the result to everyone. */
  const updateUser = async (
    userId: string,
    change: { display_name?: string; avatar_file_id?: string | null },
  ) => {
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
  };

  /** Removes a replaced photo: its row and its bytes. Best effort; an orphan only costs disk. */
  const dropFile = async (fileId: string | null) => {
    if (!fileId) return;
    const file = await db
      .deleteFrom('files')
      .where('id', '=', fileId)
      .returning('storage_key')
      .executeTakeFirst();
    if (file) await store.remove(file.storage_key).catch(() => undefined);
  };

  app.patch('/me', { preHandler: requireAuth }, async (request): Promise<User> => {
    const { displayName } = parseRequest(UpdateProfileRequest, request.body, 'body');
    return updateUser(auth(request).userId, { display_name: displayName });
  });

  app.put('/me/avatar', { preHandler: requireAuth }, async (request): Promise<User> => {
    const { userId } = auth(request);
    const part = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
    if (!part) throw new AppError(400, 'validation_failed', 'Send the photo as a file.');
    const input = await part.toBuffer().catch(() => {
      throw new AppError(413, 'validation_failed', 'The photo is too large.', [
        { path: ['body', 'file'], message: 'Too large.', code: 'file_too_large' },
      ]);
    });
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
        original_name: part.filename.slice(0, 255) || 'avatar',
        mime: 'image/webp',
        size_bytes: image.data.length,
        sha256: createHash('sha256').update(image.data).digest(),
        storage_key: key,
        width: image.width,
        height: image.height,
      })
      .execute();

    const previous = await db
      .selectFrom('users')
      .select('avatar_file_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const user = await updateUser(userId, { avatar_file_id: id });
    await dropFile(previous.avatar_file_id);
    return user;
  });

  app.delete('/me/avatar', { preHandler: requireAuth }, async (request): Promise<User> => {
    const { userId } = auth(request);
    const previous = await db
      .selectFrom('users')
      .select('avatar_file_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const user = await updateUser(userId, { avatar_file_id: null });
    await dropFile(previous.avatar_file_id);
    return user;
  });

  /** Signs out every other device: whoever might know the old password is out. */
  app.post('/me/password', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseRequest(ChangePasswordRequest, request.body, 'body');
    const { userId, sessionId } = auth(request);
    const row = await db
      .selectFrom('users')
      .innerJoin('credentials', 'credentials.user_id', 'users.id')
      .select(['users.username', 'credentials.password_hash'])
      .where('users.id', '=', userId)
      .executeTakeFirstOrThrow();
    if (!(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw new AppError(400, 'validation_failed', 'The current password is wrong.', [
        { path: ['body', 'currentPassword'], message: 'Wrong password.', code: 'wrong_password' },
      ]);
    }
    const problem = passwordProblem(body.newPassword, row.username);
    if (problem)
      throw new AppError(400, 'validation_failed', problem.message, [
        { path: ['body', 'newPassword'], ...problem },
      ]);

    const others = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('credentials')
        .set({
          password_hash: await hashPassword(body.newPassword),
          password_changed_at: new Date(),
        })
        .where('user_id', '=', userId)
        .execute();
      return trx
        .updateTable('sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', userId)
        .where('id', '<>', sessionId)
        .where('revoked_at', 'is', null)
        .returning('id')
        .execute();
    });
    for (const { id } of others) hub.closeSession(id);
    return reply.code(204).send();
  });
}
