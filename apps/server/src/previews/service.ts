import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import { z } from 'zod';
import { extractLinks, newId } from '@hasbihal/core';
import type { Database } from '../db/schema.ts';
import { appendEvent } from '../gateway/events.ts';
import { hydrateMessages } from '../chat/model.ts';
import { storageKey, type FileStore } from '../files/store.ts';
import { enqueueJob, type JobHandler } from '../jobs/queue.ts';
import { FetchError, type Fetcher } from './fetcher.ts';
import { decodeHtml, parsePageMeta } from './parse.ts';

export const LINK_PREVIEW_JOB = 'link_preview';

/** Longer addresses aren't previewed (and aren't worth a database key). */
const URL_MAX = 2048;
const HTML_MAX_BYTES = 512 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Preview pictures are stored at most this size (they show as a card's picture). */
const IMAGE_BOX = 1200;
/** Messages updated when a preview arrives: recent ones; older ones get it on their next load. */
const ANNOUNCE_MAX = 100;

/**
 * In the message's own transaction: records which links it previews, and queues a fetch for any
 * address not seen before (results are cached per URL, A24). Returns whether anything was queued.
 */
export async function linkMessage(
  trx: Kysely<Database>,
  messageId: string,
  body: string,
): Promise<boolean> {
  await trx.deleteFrom('message_links').where('message_id', '=', messageId).execute();
  const urls = extractLinks(body).filter((url) => url.length <= URL_MAX);
  if (!urls.length) return false;
  const fresh = await trx
    .insertInto('link_previews')
    .values(urls.map((url) => ({ url, status: 'pending' as const })))
    .onConflict((oc) => oc.column('url').doNothing())
    .returning('url')
    .execute();
  for (const { url } of fresh) await enqueueJob(trx, LINK_PREVIEW_JOB, { url });
  await trx
    .insertInto('message_links')
    .values(urls.map((url, position) => ({ message_id: messageId, url, position })))
    .execute();
  return fresh.length > 0;
}

/**
 * The job (ARCHITECTURE §7): fetch the page through the safe fetcher, read its metadata, keep a
 * copy of its picture in our own storage, and update the messages that link it.
 */
export function linkPreviewJob(deps: {
  db: Kysely<Database>;
  store: FileStore;
  fetcher: Fetcher;
  /** After the update's events are committed. */
  committed: () => void;
}): JobHandler {
  const { db, store, fetcher, committed } = deps;
  return async (payload) => {
    const { url } = z.object({ url: z.string() }).parse(payload);
    let meta;
    try {
      const page = await fetcher.fetch(url, {
        accept: ['text/html', 'application/xhtml+xml'],
        maxBytes: HTML_MAX_BYTES,
        truncate: true,
      });
      meta = parsePageMeta(decodeHtml(page.contentType, page.body), page.url);
    } catch (error) {
      // A site that is down may be back later; a page that isn't one never will be.
      if (!(error instanceof FetchError) || error.retryable) throw error;
      meta = null;
    }

    const imageFileId = meta?.title && meta.imageUrl ? await storeImage(meta.imageUrl) : null;
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('link_previews')
        .set({
          status: meta?.title ? 'ok' : 'none',
          title: meta?.title ?? null,
          description: meta?.description ?? null,
          site_name: meta?.siteName ?? null,
          image_file_id: imageFileId,
          fetched_at: new Date(),
        })
        .where('url', '=', url)
        .execute();
      if (!meta?.title) return;
      const rows = await trx
        .selectFrom('messages')
        .innerJoin('message_links', 'message_links.message_id', 'messages.id')
        .selectAll('messages')
        .where('message_links.url', '=', url)
        .where('messages.deleted_at', 'is', null)
        .orderBy('messages.created_at', 'desc')
        .limit(ANNOUNCE_MAX)
        .execute();
      for (const message of await hydrateMessages(trx, rows))
        await appendEvent(trx, { type: 'message_updated', message });
    });
    committed();

    async function storeImage(imageUrl: string): Promise<string | null> {
      try {
        const image = await fetcher.fetch(imageUrl, {
          accept: ['image/'],
          maxBytes: IMAGE_MAX_BYTES,
          truncate: false,
        });
        const { data, info } = await sharp(image.body, { limitInputPixels: 50_000_000 })
          .rotate()
          .resize(IMAGE_BOX, IMAGE_BOX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        // Kept under the name of whoever first linked it: files need an uploader.
        const linker = await db
          .selectFrom('message_links')
          .innerJoin('messages', 'messages.id', 'message_links.message_id')
          .select('messages.author_id')
          .where('message_links.url', '=', url)
          .orderBy('messages.created_at')
          .executeTakeFirst();
        if (!linker) return null;
        const id = newId();
        const key = storageKey(id, 'webp');
        await store.put(key, data);
        await db
          .insertInto('files')
          .values({
            id,
            uploader_id: linker.author_id,
            kind: 'image',
            original_name: 'onizleme.webp',
            mime: 'image/webp',
            size_bytes: data.length,
            sha256: createHash('sha256').update(data).digest(),
            storage_key: key,
            width: info.width,
            height: info.height,
          })
          .execute();
        return id;
      } catch {
        return null; // a preview without its picture is still a preview
      }
    }
  };
}
