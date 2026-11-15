import sharp from 'sharp';
import { AppError } from '../errors.ts';

/** Refuse images over ~40 megapixels before decoding them (decompression bombs). */
const MAX_INPUT_PIXELS = 40_000_000;
export const AVATAR_SIZE = 256;

/**
 * A profile photo as a 256 px square WebP: rotated upright from EXIF, center-cropped, and
 * re-encoded, which also drops all metadata (camera, GPS location) from the original.
 */
export async function processAvatar(
  input: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError(400, 'validation_failed', 'That file is not an image we can use.', [
      { path: ['body', 'file'], message: 'Not a supported image.', code: 'not_an_image' },
    ]);
  }
}
