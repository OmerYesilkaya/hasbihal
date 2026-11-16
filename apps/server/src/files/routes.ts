import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { Id } from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import type { FileStore } from './store.ts';

/** Files are readable by every signed-in member (A8: everything is shared). */
export function registerFiles(
  app: FastifyInstance,
  db: Kysely<Database>,
  store: FileStore,
  { requireAuth }: AuthGuards,
): void {
  app.get('/files/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = parseRequest(z.object({ id: Id }), request.params, 'params');
    const file = await db
      .selectFrom('files')
      .select(['mime', 'size_bytes', 'storage_key'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!file) throw new AppError(404, 'not_found', 'No such file.');
    const stream = await store.read(file.storage_key).catch(() => {
      throw new AppError(404, 'not_found', 'No such file.');
    });
    return (
      reply
        .header('content-type', file.mime)
        .header('content-length', file.size_bytes)
        // A file id always means the same bytes, so clients may keep it forever (privately).
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(stream)
    );
  });
}
