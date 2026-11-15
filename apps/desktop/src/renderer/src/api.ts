import type { z } from 'zod';
import { ApiError } from '@hasbihal/protocol';
import type { AuthError } from '../../shared/app-info.ts';

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: AuthError };

const unreachable: AuthError = { code: 'unavailable', message: 'The server cannot be reached.' };

/**
 * A request to the server with the session's access token. `schema` parses the answer; without
 * it the answer is ignored (204s). Errors come back as the server's `ApiError`, or `unavailable`.
 */
export async function api<S extends z.ZodType>(
  serverUrl: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { body?: unknown; schema?: S } = {},
): Promise<ApiResult<z.infer<S> | null>> {
  const token = await window.hasbihal.auth.accessToken();
  if (!token.ok) return token;
  const { body } = options;
  // FormData (uploads) is sent as is, with its own multipart content type; anything else as JSON.
  const payload =
    body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(new URL(path, serverUrl), {
      method,
      headers: {
        authorization: `Bearer ${token.value}`,
        ...(typeof payload === 'string' ? { 'content-type': 'application/json' } : {}),
      },
      body: payload,
    });
  } catch {
    return { ok: false, error: unreachable };
  }
  const json: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiError.safeParse(json);
    return { ok: false, error: parsed.success ? parsed.data.error : unreachable };
  }
  if (!options.schema) return { ok: true, value: null };
  const parsed = options.schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: { code: 'internal', message: 'Unexpected server response.' } };
}

/** GET that only cares about success: state the gateway will ask to reload anyway. */
export async function apiGet<S extends z.ZodType>(
  serverUrl: string,
  path: string,
  schema: S,
): Promise<z.infer<S> | undefined> {
  const result = await api(serverUrl, 'GET', path, { schema });
  return result.ok ? (result.value ?? undefined) : undefined;
}

const fileUrls = new Map<string, Promise<string | null>>();

/**
 * A local URL for a stored file (`GET /files/:id` needs the session token, which an <img> can't
 * send). Fetched once per file id and kept: a file id always means the same bytes.
 */
export function fileUrl(serverUrl: string, fileId: string): Promise<string | null> {
  let url = fileUrls.get(fileId);
  if (!url) {
    url = (async () => {
      const token = await window.hasbihal.auth.accessToken();
      if (!token.ok) return null;
      const response = await fetch(new URL(`/files/${fileId}`, serverUrl), {
        headers: { authorization: `Bearer ${token.value}` },
      }).catch(() => null);
      return response?.ok ? URL.createObjectURL(await response.blob()) : null;
    })();
    const pending = url;
    // A failure isn't cached, so the next render tries again.
    void pending.then((result) => {
      if (result === null && fileUrls.get(fileId) === pending) fileUrls.delete(fileId);
    });
    fileUrls.set(fileId, url);
  }
  return url;
}
