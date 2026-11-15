import type { z } from 'zod';

/**
 * GET from the server with the session's access token. Returns undefined on any failure: callers
 * load state that the gateway will ask them to load again after the next reconnect anyway.
 */
export async function apiGet<S extends z.ZodType>(
  serverUrl: string,
  path: string,
  schema: S,
): Promise<z.infer<S> | undefined> {
  const token = await window.hasbihal.auth.accessToken();
  if (!token.ok) return undefined;
  try {
    const response = await fetch(new URL(path, serverUrl), {
      headers: { authorization: `Bearer ${token.value}` },
    });
    if (!response.ok) return undefined;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
