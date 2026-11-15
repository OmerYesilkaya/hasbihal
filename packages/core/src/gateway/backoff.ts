/**
 * Reconnect delay with exponential growth and full jitter, so a server restart
 * doesn't make every client reconnect at the same instant.
 */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 30_000 };

export function reconnectDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}
