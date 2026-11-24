import { KNOCK_TTL_MS } from '@hasbihal/protocol';

/**
 * The Mahrem rooms this app knocked on and waits at (A55), until someone on the list answers or
 * the knock lapses. React reads it as an external store.
 */
export class Knocking {
  #waiting: ReadonlySet<string> = new Set();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): ReadonlySet<string> => this.#waiting;

  start(roomId: string): void {
    clearTimeout(this.#timers.get(roomId));
    this.#timers.set(
      roomId,
      setTimeout(() => {
        this.stop(roomId);
      }, KNOCK_TTL_MS),
    );
    this.#set(new Set([...this.#waiting, roomId]));
  }

  stop(roomId: string): void {
    clearTimeout(this.#timers.get(roomId));
    this.#timers.delete(roomId);
    if (this.#waiting.has(roomId))
      this.#set(new Set([...this.#waiting].filter((id) => id !== roomId)));
  }

  #set(next: ReadonlySet<string>): void {
    this.#waiting = next;
    for (const listener of this.#listeners) listener();
  }
}
