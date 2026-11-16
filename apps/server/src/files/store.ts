import { createReadStream, type ReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Where file bytes live (ARCHITECTURE T6): behind this interface, so the local disk can be
 * swapped for S3-compatible object storage without touching the routes.
 */
export interface FileStore {
  put(key: string, data: Buffer): Promise<void>;
  /** Moves a finished local file (an upload) in under `key`; the local file is gone afterwards. */
  putFile(key: string, localPath: string): Promise<void>;
  /**
   * A stream of the bytes, or of `range` (inclusive byte offsets, as in HTTP); rejects (ENOENT)
   * when the key doesn't exist.
   */
  read(key: string, range?: ByteRange): Promise<ReadStream>;
  remove(key: string): Promise<void>;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Keys like `ab/cd/<id>.webp`: two levels of fan-out keep directories small. */
export function storageKey(id: string, extension: string): string {
  const hex = id.replaceAll('-', '');
  return `${hex.slice(-2)}/${hex.slice(-4, -2)}/${id}.${extension}`;
}

export class LocalFileStore implements FileStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #path(key: string): string {
    const full = path.resolve(this.#root, key);
    // Keys come from our own code, but a path that escapes the root must never be served.
    if (!full.startsWith(this.#root + path.sep)) throw new Error(`invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.#path(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write then rename, so a crash never leaves a half-written file under a real key.
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, target);
  }

  async putFile(key: string, localPath: string): Promise<void> {
    const target = this.#path(key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await rename(localPath, target);
    } catch (error) {
      // Another file system (e.g. the temp directory on another volume): copy, then rename.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      const temporary = `${target}.${randomUUID()}.tmp`;
      await copyFile(localPath, temporary);
      await rename(temporary, target);
      await rm(localPath, { force: true });
    }
  }

  read(key: string, range?: ByteRange): Promise<ReadStream> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(this.#path(key), range);
      stream.once('open', () => {
        resolve(stream);
      });
      stream.once('error', reject);
    });
  }

  async remove(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }
}
