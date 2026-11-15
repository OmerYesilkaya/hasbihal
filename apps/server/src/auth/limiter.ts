/**
 * Counts failed attempts per key (a username) in a sliding window, in memory. The server is a
 * single instance (A4), and a restart resetting the counters is acceptable for a family server.
 */
export class AttemptLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #failures = new Map<string, number[]>();

  constructor(max: number, windowMs: number) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  /** Milliseconds until another attempt is allowed, or 0 when allowed now. */
  retryAfterMs(key: string, now = Date.now()): number {
    const recent = this.#recent(key, now);
    if (recent.length < this.#max) return 0;
    return (recent[recent.length - this.#max] ?? now) + this.#windowMs - now;
  }

  recordFailure(key: string, now = Date.now()): void {
    this.#failures.set(key, [...this.#recent(key, now), now]);
  }

  reset(key: string): void {
    this.#failures.delete(key);
  }

  #recent(key: string, now: number): number[] {
    const recent = (this.#failures.get(key) ?? []).filter((t) => now - t < this.#windowMs);
    if (recent.length) this.#failures.set(key, recent);
    else this.#failures.delete(key);
    return recent;
  }
}
