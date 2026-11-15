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
  let response: Response;
  try {
    response = await fetch(new URL(path, serverUrl), {
      method,
      headers: {
        authorization: `Bearer ${token.value}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
