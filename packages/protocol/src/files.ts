import { z } from 'zod';
import { Id } from './id.ts';

// Files and attachments (ARCHITECTURE §7, DECISIONS A23, A26).

/** A26: per file. */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
/** Files on one message. */
export const ATTACHMENTS_MAX = 10;

export const FileKind = z.enum(['image', 'video', 'audio', 'voice', 'other']);
export type FileKind = z.infer<typeof FileKind>;

/** A stored file as messages carry it. The bytes are fetched through signed URLs (`FileUrls`). */
export const Attachment = z.object({
  id: Id,
  kind: FileKind,
  /** The name it was uploaded with. */
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  /** Images and videos: as displayed (EXIF rotation applied). */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** Videos, audio, and voice messages. */
  durationMs: z.number().int().nonnegative().nullable(),
  /** A small WebP preview exists (images, and videos with a poster frame). */
  hasThumbnail: z.boolean(),
});
export type Attachment = z.infer<typeof Attachment>;

/** `POST /files/urls`: signed addresses for files, so `<img>` and `<video>` can load them. */
export const FileUrlsRequest = z.object({ ids: z.array(Id).min(1).max(100) });
export type FileUrlsRequest = z.infer<typeof FileUrlsRequest>;

/** Paths on the server (`/files/…?…`), to resolve against its address. */
const ServerPath = z.string().startsWith('/');

export const FileUrl = z.object({
  original: ServerPath,
  thumbnail: ServerPath.nullable(),
  /** After this, ask again. */
  expiresAt: z.iso.datetime(),
});
export type FileUrl = z.infer<typeof FileUrl>;

/** By file id; unknown ids are left out. */
export const FileUrls = z.object({ urls: z.record(Id, FileUrl) });
export type FileUrls = z.infer<typeof FileUrls>;
