import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp, { type Metadata } from 'sharp';
import type { FileKind } from '@hasbihal/protocol';

const run = promisify(execFile);

/** What the server learns about an upload, besides its bytes (ARCHITECTURE §7). */
export interface MediaInfo {
  kind: Exclude<FileKind, 'voice'>;
  /** The type it is served as. Anything the app wouldn't show inline is `application/octet-stream`. */
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** A small WebP preview (images; video poster frames when ffmpeg is installed). */
  thumbnail: Buffer | null;
}

/** Thumbnails fit in this box; enough for a chat bubble on a high-density screen. */
const THUMBNAIL_BOX = 800;
/** sharp refuses images beyond this many pixels (decompression bombs). */
const MAX_PIXELS = 100_000_000;

/** Image formats every client can show; others (HEIC, TIFF, SVG, …) become plain files. */
const IMAGE_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

/**
 * Video and audio the app plays inline. The type comes from the uploader, so it is only a hint:
 * served with `nosniff`, a wrong one just fails to play and the viewer offers a download.
 */
const PLAYABLE = /^(video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|webm|wav|x-wav|aac|flac))$/;

/**
 * Looks at an uploaded file: what kind it is, its size and duration, and a thumbnail. The file
 * itself is never changed (A26). Anything unrecognised is an ordinary file.
 */
export async function inspectUpload(localPath: string, claimedMime: string): Promise<MediaInfo> {
  const image = await inspectImage(localPath);
  if (image) return image;
  const mime = claimedMime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (PLAYABLE.test(mime)) {
    if (mime.startsWith('video/')) return inspectVideo(localPath, mime);
    return {
      ...(await probe(localPath)),
      kind: 'audio',
      mime,
      width: null,
      height: null,
      thumbnail: null,
    };
  }
  return other();
}

const other = (): MediaInfo => ({
  kind: 'other',
  mime: 'application/octet-stream',
  width: null,
  height: null,
  durationMs: null,
  thumbnail: null,
});

async function inspectImage(localPath: string): Promise<MediaInfo | null> {
  let metadata: Metadata;
  try {
    metadata = await sharp(localPath, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return null; // not an image sharp can read
  }
  const mime = IMAGE_MIME[metadata.format];
  if (!mime || !metadata.width || !metadata.height) return null;
  // EXIF orientations 5–8 are rotated by 90°: the picture as shown is the other way round.
  const turned = (metadata.orientation ?? 1) >= 5;
  const thumbnail = await sharp(localPath, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(THUMBNAIL_BOX, THUMBNAIL_BOX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
    .catch(() => null);
  return {
    kind: 'image',
    mime,
    width: turned ? metadata.height : metadata.width,
    height: turned ? metadata.width : metadata.height,
    durationMs: null,
    thumbnail,
  };
}

async function inspectVideo(localPath: string, mime: string): Promise<MediaInfo> {
  const { durationMs, width, height } = await probe(localPath);
  let thumbnail: Buffer | null = null;
  if (await hasFfmpeg()) {
    try {
      // A frame a little way in: the very first is often black.
      const at = durationMs && durationMs > 2000 ? '1' : '0';
      const { stdout } = await run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-ss',
          at,
          '-i',
          localPath,
          '-frames:v',
          '1',
          '-f',
          'image2pipe',
          '-c:v',
          'png',
          '-',
        ],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20_000 },
      );
      thumbnail = await sharp(stdout)
        .resize(THUMBNAIL_BOX, THUMBNAIL_BOX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      thumbnail = null;
    }
  }
  return { kind: 'video', mime, width, height, durationMs, thumbnail };
}

/** Duration and picture size from ffprobe; all null without it. */
async function probe(
  localPath: string,
): Promise<{ durationMs: number | null; width: number | null; height: number | null }> {
  const none = { durationMs: null, width: null, height: null };
  if (!(await hasFfmpeg())) return none;
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', localPath],
      { timeout: 20_000 },
    );
    const info = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: {
        codec_type?: string;
        width?: number;
        height?: number;
        side_data_list?: { rotation?: number }[];
        tags?: { rotate?: string };
      }[];
    };
    const video = info.streams?.find((s) => s.codec_type === 'video');
    const seconds = Number(info.format?.duration);
    // Phones record sideways and say so; the picture as played is turned.
    const rotation = Math.abs(
      Number(
        video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
          video?.tags?.rotate ??
          0,
      ),
    );
    const turned = rotation === 90 || rotation === 270;
    const w = video?.width ?? null;
    const h = video?.height ?? null;
    return {
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
      width: turned ? h : w,
      height: turned ? w : h,
    };
  } catch {
    return none;
  }
}

let ffmpegAvailable: Promise<boolean> | undefined;

/** ffmpeg is optional (the production image has it): without it, videos get no poster. */
function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= run('ffprobe', ['-version']).then(
    () => true,
    () => false,
  );
  return ffmpegAvailable;
}
