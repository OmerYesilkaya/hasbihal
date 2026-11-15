import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { z } from 'zod';
import { newId } from '@hasbihal/core';
import {
  FileUrlsRequest,
  Id,
  UPLOAD_MAX_BYTES,
  type Attachment,
  type FileUrls,
} from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database, FilesTable } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { inspectUpload } from './media.ts';
import { FILE_URL_TTL_MS, type FileUrlSigner, type FileVariant } from './signing.ts';
import { storageKey, type ByteRange, type FileStore } from './store.ts';

const MAX_NAME = 255;

export function toAttachment(
  row: Pick<
    Selectable<FilesTable>,
    | 'id'
    | 'kind'
    | 'original_name'
    | 'mime'
    | 'size_bytes'
    | 'width'
    | 'height'
    | 'duration_ms'
    | 'thumbnail_key'
  >,
): Attachment {
  return {
    id: row.id,
    kind: row.kind,
    name: row.original_name,
    mime: row.mime,
    size: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    hasThumbnail: row.thumbnail_key !== null,
  };
}

const tooLarge = () =>
  new AppError(413, 'validation_failed', 'The file is larger than 100 MB.', [
    { path: ['body', 'file'], message: 'Too large.', code: 'file_too_large' },
  ]);

const SignedQuery = z.object({
  u: Id,
  e: z.coerce.number().int(),
  s: z.string().max(100),
});

/** `bytes=start-end` (one range; open ends allowed), or null for the whole file. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (match[1] === '') {
    // The last N bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

/** RFC 6266: a download name that survives any characters (Turkish ones included). */
const disposition = (type: 'inline' | 'attachment', name: string) =>
  `${type}; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * Uploads and downloads (ARCHITECTURE §7). Files are readable by every signed-in member (A8:
 * everything is shared), with the access token or a signed address.
 */
export function registerFiles(
  app: FastifyInstance,
  deps: {
    db: Kysely<Database>;
    store: FileStore;
    signer: FileUrlSigner;
    guards: AuthGuards;
  },
): void {
  const { db, store, signer, guards } = deps;
  const { requireAuth, auth } = guards;

  // ---- upload ----------------------------------------------------------------------------------

  app.post('/files', { preHandler: requireAuth }, async (request, reply): Promise<Attachment> => {
    const { userId } = auth(request);
    const part = await request.file({ limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } });
    if (!part) throw new AppError(400, 'validation_failed', 'Send the file as multipart.');

    // Streamed to a temporary file while hashing: a 100 MB video never sits in memory.
    const dir = await mkdtemp(path.join(tmpdir(), 'hasbihal-upload-'));
    const temporary = path.join(dir, 'upload');
    try {
      const hash = createHash('sha256');
      let size = 0;
      await pipeline(
        part.file,
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk);
            size += chunk.length;
            done(null, chunk);
          },
        }),
        createWriteStream(temporary),
      );
      if (part.file.truncated) throw tooLarge();
      if (size === 0) throw new AppError(400, 'validation_failed', 'The file is empty.');

      const info = await inspectUpload(temporary, part.mimetype);
      const id = newId();
      const key = storageKey(id, 'bin');
      const thumbnailKey = info.thumbnail ? storageKey(id, 'thumb.webp') : null;
      if (info.thumbnail && thumbnailKey) await store.put(thumbnailKey, info.thumbnail);
      await store.putFile(key, temporary);
      const row = await db
        .insertInto('files')
        .values({
          id,
          uploader_id: userId,
          kind: info.kind,
          original_name: part.filename.normalize('NFC').slice(0, MAX_NAME) || 'dosya',
          mime: info.mime,
          size_bytes: size,
          sha256: hash.digest(),
          storage_key: key,
          width: info.width,
          height: info.height,
          duration_ms: info.durationMs,
          thumbnail_key: thumbnailKey,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      void reply.code(201);
      return toAttachment(row);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ---- signed addresses ------------------------------------------------------------------------

  app.post('/files/urls', { preHandler: requireAuth }, async (request): Promise<FileUrls> => {
    const { ids } = parseRequest(FileUrlsRequest, request.body, 'body');
    const { userId } = auth(request);
    const rows = await db
      .selectFrom('files')
      .select(['id', 'thumbnail_key'])
      .where('id', 'in', ids)
      .execute();
    const expiresAt = Date.now() + FILE_URL_TTL_MS;
    const expires = Math.floor(expiresAt / 1000);
    const address = (id: string, variant: FileVariant) => {
      const { signature } = signer.sign(id, variant, userId, expires);
      const query = new URLSearchParams({ u: userId, e: String(expires), s: signature });
      return `/files/${id}${variant === 'thumbnail' ? '/thumbnail' : ''}?${query.toString()}`;
    };
    return {
      urls: Object.fromEntries(
        rows.map((row) => [
          row.id,
          {
            original: address(row.id, 'original'),
            thumbnail: row.thumbnail_key ? address(row.id, 'thumbnail') : null,
            expiresAt: new Date(expiresAt).toISOString(),
          },
        ]),
      ),
    };
  });

  // ---- download --------------------------------------------------------------------------------

  /** A signed address, or else the access token. */
  const allowed = async (
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    variant: FileVariant,
  ) => {
    const query = request.query as Record<string, unknown>;
    if (query.s === undefined) {
      await requireAuth.call(app, request, reply);
      return;
    }
    const signed = SignedQuery.safeParse(query);
    if (
      !signed.success ||
      !signer.verify(id, variant, {
        userId: signed.data.u,
        expires: signed.data.e,
        signature: signed.data.s,
      })
    )
      throw new AppError(403, 'forbidden', 'This file address is invalid or has expired.');
  };

  const serve = (variant: FileVariant) => async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = parseRequest(z.object({ id: Id }), request.params, 'params');
    await allowed(request, reply, id, variant);
    const file = await db
      .selectFrom('files')
      .select(['kind', 'original_name', 'mime', 'size_bytes', 'storage_key', 'thumbnail_key'])
      .where('id', '=', id)
      .executeTakeFirst();
    const key = variant === 'thumbnail' ? file?.thumbnail_key : file?.storage_key;
    if (!file || !key) throw new AppError(404, 'not_found', 'No such file.');

    void reply
      .header('x-content-type-options', 'nosniff')
      // A file id always means the same bytes, so clients may keep it forever (privately).
      .header('cache-control', 'private, max-age=31536000, immutable');
    if (variant === 'thumbnail') {
      const stream = await store.read(key).catch(() => {
        throw new AppError(404, 'not_found', 'No such file.');
      });
      return reply.header('content-type', 'image/webp').send(stream);
    }

    const size = Number(file.size_bytes);
    const range = parseRange(request.headers.range, size);
    if (range === 'invalid')
      return reply
        .code(416)
        .header('content-range', `bytes */${String(size)}`)
        .send();
    const stream = await store.read(key, range ?? undefined).catch(() => {
      throw new AppError(404, 'not_found', 'No such file.');
    });
    void reply
      .header('content-type', file.mime)
      .header('accept-ranges', 'bytes')
      .header(
        'content-disposition',
        disposition(file.kind === 'other' ? 'attachment' : 'inline', file.original_name),
      );
    if (!range) return reply.header('content-length', size).send(stream);
    return reply
      .code(206)
      .header('content-range', `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`)
      .header('content-length', range.end - range.start + 1)
      .send(stream);
  };

  app.get('/files/:id', serve('original'));
  app.get('/files/:id/thumbnail', serve('thumbnail'));
}
