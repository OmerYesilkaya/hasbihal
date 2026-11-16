import { useEffect, useState } from 'react';
import { ApiError, Attachment, FileUrls, type FileUrl } from '@hasbihal/protocol';
import type { ApiResult } from './api.ts';
import { api } from './api.ts';

const unreachable = { code: 'unavailable', message: 'The server cannot be reached.' } as const;

/**
 * Uploads a file (`POST /files`), reporting progress from 0 to 1. XMLHttpRequest because fetch
 * can't report upload progress, which a 100 MB video needs.
 */
export async function uploadFile(
  serverUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  /** A recorded voice message (A22), with the recorder's measured length. */
  voice?: { durationMs: number },
): Promise<ApiResult<Attachment>> {
  const token = await window.hasbihal.auth.accessToken();
  if (!token.ok) return token;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const url = new URL('/files', serverUrl);
    if (voice) {
      url.searchParams.set('kind', 'voice');
      url.searchParams.set('durationMs', String(Math.round(voice.durationMs)));
    }
    xhr.open('POST', url);
    xhr.setRequestHeader('authorization', `Bearer ${token.value}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body: unknown = xhr.response;
      if (xhr.status === 201) {
        const parsed = Attachment.safeParse(body);
        resolve(
          parsed.success
            ? { ok: true, value: parsed.data }
            : { ok: false, error: { code: 'internal', message: 'Unexpected server response.' } },
        );
        return;
      }
      const error = ApiError.safeParse(body);
      resolve({ ok: false, error: error.success ? error.data.error : unreachable });
    };
    xhr.onerror = () => {
      resolve({ ok: false, error: unreachable });
    };
    xhr.onabort = () => {
      resolve({ ok: false, error: { code: 'unavailable', message: 'Cancelled.' } });
    };
    signal.addEventListener('abort', () => {
      xhr.abort();
    });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

/** Signed addresses, resolved against the server: ready for `<img>` and `<video>`. */
export interface FileAddresses {
  original: string;
  thumbnail: string | null;
}

/** Ask again this long before an address expires, so a page left open never shows broken files. */
const RENEW_BEFORE_MS = 30 * 60 * 1000;

/**
 * Signed file addresses (ARCHITECTURE §7), asked for in batches: a screen of photos is one
 * request. Kept until shortly before they expire.
 */
class FileAddressCache {
  readonly #cache = new Map<string, { addresses: FileAddresses; renewAt: number }>();
  readonly #waiting = new Map<string, ((a: FileAddresses | null) => void)[]>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #serverUrl = '';

  get(serverUrl: string, fileId: string): FileAddresses | null {
    const hit = this.#cache.get(fileId);
    return hit && hit.renewAt > Date.now() && this.#serverUrl === serverUrl ? hit.addresses : null;
  }

  load(serverUrl: string, fileId: string): Promise<FileAddresses | null> {
    const hit = this.get(serverUrl, fileId);
    if (hit) return Promise.resolve(hit);
    this.#serverUrl = serverUrl;
    return new Promise((resolve) => {
      this.#waiting.set(fileId, [...(this.#waiting.get(fileId) ?? []), resolve]);
      if (this.#timer === null) this.#timer = setTimeout(() => void this.#flush(), 10);
    });
  }

  async #flush(): Promise<void> {
    this.#timer = null;
    const batch = [...this.#waiting];
    this.#waiting.clear();
    const serverUrl = this.#serverUrl;
    for (let i = 0; i < batch.length; i += 100) {
      const part = batch.slice(i, i + 100);
      const result = await api(serverUrl, 'POST', '/files/urls', {
        body: { ids: part.map(([id]) => id) },
        schema: FileUrls,
      });
      const urls: Record<string, FileUrl> = result.ok && result.value ? result.value.urls : {};
      for (const [id, resolvers] of part) {
        const url = urls[id];
        const addresses = url
          ? {
              original: new URL(url.original, serverUrl).toString(),
              thumbnail: url.thumbnail ? new URL(url.thumbnail, serverUrl).toString() : null,
            }
          : null;
        if (url && addresses)
          this.#cache.set(id, {
            addresses,
            renewAt: Date.parse(url.expiresAt) - RENEW_BEFORE_MS,
          });
        for (const resolve of resolvers) resolve(addresses);
      }
    }
  }
}

const addresses = new FileAddressCache();

/** A file's signed addresses, once known (null meanwhile, or when it's gone). */
export function useFileAddresses(serverUrl: string, fileId: string): FileAddresses | null {
  const [value, setValue] = useState(() => addresses.get(serverUrl, fileId));
  useEffect(() => {
    let current = true;
    void addresses.load(serverUrl, fileId).then((a) => {
      if (current) setValue(a);
    });
    return () => {
      current = false;
    };
  }, [serverUrl, fileId]);
  return value;
}

/** "2,4 MB", in the app's language. */
export function formatSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[unit] ?? 'B'}`;
}

/** "1:05" for a minute and five seconds. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes)}:${seconds}`;
}
