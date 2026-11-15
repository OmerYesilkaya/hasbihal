import { APP_URL_SCHEME } from '@hasbihal/protocol';

/** A `hasbihal://` link the app acts on (DECISIONS A51). */
export interface DeepLink {
  kind: 'invite' | 'recover';
  token: string;
}

/** Tokens are base64url (server `randomToken`); anything else is not ours. */
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;

/**
 * Parses `hasbihal://invite/<token>` or `hasbihal://recover/<token>`. Links come from other apps
 * and the OS, so everything else, including extra path parts or a query, is rejected.
 */
export function parseDeepLink(raw: string): DeepLink | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== `${APP_URL_SCHEME}:` || url.search || url.hash) return undefined;
  const kind = url.hostname;
  if (kind !== 'invite' && kind !== 'recover') return undefined;
  const token = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  return TOKEN.test(token) ? { kind, token } : undefined;
}

/**
 * Accepts what someone pastes into the sign-up or recovery form: a full link or the bare token.
 * Returns the token, or undefined when it can't be one.
 */
export function tokenFromInput(input: string, kind: DeepLink['kind']): string | undefined {
  const trimmed = input.trim();
  if (trimmed.includes('://')) {
    const link = parseDeepLink(trimmed);
    return link?.kind === kind ? link.token : undefined;
  }
  return TOKEN.test(trimmed) ? trimmed : undefined;
}

/** The first `hasbihal://` link among command-line arguments (how Windows passes links). */
export function deepLinkFromArgv(argv: readonly string[]): DeepLink | undefined {
  for (const arg of argv) {
    if (arg.startsWith(`${APP_URL_SCHEME}://`)) {
      const link = parseDeepLink(arg);
      if (link) return link;
    }
  }
  return undefined;
}
