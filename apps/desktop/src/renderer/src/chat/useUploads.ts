import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageKey } from '@hasbihal/core';
import { ATTACHMENTS_MAX, UPLOAD_MAX_BYTES, type Attachment } from '@hasbihal/protocol';
import { uploadFile } from '../files.ts';

/** A file on its way to the server, shown above the composer until the message is sent. */
export interface Upload {
  key: string;
  file: File;
  /** A local preview for pictures. */
  preview: string | null;
  progress: number;
  status: 'uploading' | 'done' | 'failed';
  attachment: Attachment | null;
  error: MessageKey | null;
}

let counter = 0;

/**
 * Uploads start as soon as files are added (pasted, dropped, or picked), so sending is instant
 * when the message is ready (ARCHITECTURE §7).
 */
export function useUploads(serverUrl: string) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  /** The list as last rendered, for callbacks that must not change identity with it. */
  const latest = useRef(uploads);
  useLayoutEffect(() => {
    latest.current = uploads;
  }, [uploads]);

  const update = useCallback((key: string, change: Partial<Upload>) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));
  }, []);

  const start = useCallback(
    (key: string, file: File) => {
      const controller = new AbortController();
      controllers.current.set(key, controller);
      update(key, { status: 'uploading', progress: 0, error: null });
      void uploadFile(
        serverUrl,
        file,
        (progress) => {
          update(key, { progress });
        },
        controller.signal,
      ).then((result) => {
        controllers.current.delete(key);
        if (controller.signal.aborted) return;
        if (result.ok) update(key, { status: 'done', progress: 1, attachment: result.value });
        else
          update(key, {
            status: 'failed',
            error: result.error.issues?.some((d) => d.code === 'file_too_large')
              ? 'composer.fileTooLarge'
              : 'composer.uploadFailed',
          });
      });
    },
    [serverUrl, update],
  );

  /** Adds files; returns why some were left out, if any were. */
  const add = useCallback(
    (files: File[]): MessageKey | null => {
      const room = ATTACHMENTS_MAX - latest.current.length;
      const fitting = files.filter((f) => f.size <= UPLOAD_MAX_BYTES);
      const taken = fitting.slice(0, Math.max(0, room));
      const added = taken.map((file): Upload => ({
        key: `upload-${String(++counter)}`,
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        progress: 0,
        status: 'uploading',
        attachment: null,
        error: null,
      }));
      setUploads((list) => [...list, ...added]);
      for (const u of added) start(u.key, u.file);
      if (fitting.length < files.length) return 'composer.fileTooLarge';
      if (taken.length < fitting.length) return 'composer.tooManyFiles';
      return null;
    },
    [start],
  );

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setUploads((list) => {
      const gone = list.find((u) => u.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((u) => u.key !== key);
    });
  }, []);

  const retry = useCallback(
    (key: string) => {
      const upload = latest.current.find((u) => u.key === key);
      if (upload) start(key, upload.file);
    },
    [start],
  );

  /** After sending: the files now belong to the message. */
  const clear = useCallback(() => {
    for (const u of latest.current) if (u.preview) URL.revokeObjectURL(u.preview);
    setUploads([]);
  }, []);

  // Leaving the room view abandons what's still uploading (the server cleans up the rest).
  useEffect(
    () => () => {
      for (const c of controllers.current.values()) c.abort();
      for (const u of latest.current) if (u.preview) URL.revokeObjectURL(u.preview);
    },
    [],
  );

  return { uploads, add, remove, retry, clear };
}
