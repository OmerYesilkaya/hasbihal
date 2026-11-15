import type { DurableEvent, PresenceStatus, User } from '@hasbihal/protocol';

/** The client's view of the shared state, fed by HTTP loads and the gateway (ARCHITECTURE §4.3). */
export interface ChatState {
  me: User | null;
  /** By id. Members are never deleted from here: departed members' messages still need them (A42). */
  members: ReadonlyMap<string, User>;
  /** Everyone not listed is offline. */
  presence: ReadonlyMap<string, PresenceStatus>;
}

const EMPTY: ChatState = { me: null, members: new Map(), presence: new Map() };

/**
 * A small external store: every change produces a new immutable snapshot, so React's
 * `useSyncExternalStore` re-renders exactly when something changed.
 */
export class ChatStore {
  #state: ChatState = EMPTY;
  readonly #listeners = new Set<() => void>();

  getSnapshot = (): ChatState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setMe(me: User): void {
    this.#update({ me, members: new Map(this.#state.members).set(me.id, me) });
  }

  /**
   * Merges a full member load (first connect or resync). It merges rather than replaces: an
   * event applied while the load was in flight may be newer than the load, and members are
   * never removed from the store anyway (A42).
   */
  setMembers(members: readonly User[]): void {
    const merged = new Map(this.#state.members);
    for (const member of members) merged.set(member.id, member);
    this.#update({ members: merged });
  }

  setPresenceSnapshot(presence: Readonly<Record<string, PresenceStatus>>): void {
    this.#update({ presence: new Map(Object.entries(presence)) });
  }

  setPresence(userId: string, status: PresenceStatus): void {
    if ((this.#state.presence.get(userId) ?? 'offline') === status) return;
    const presence = new Map(this.#state.presence);
    if (status === 'offline') presence.delete(userId);
    else presence.set(userId, status);
    this.#update({ presence });
  }

  /** Applies a durable event. Idempotent: replaying one around a reconnect changes nothing. */
  apply(event: DurableEvent): void {
    // Typed per event: a new event type doesn't compile until it has a handler below.
    this.#handlers[event.type](event);
  }

  readonly #handlers: {
    [T in DurableEvent['type']]: (event: Extract<DurableEvent, { type: T }>) => void;
  } = {
    member_joined: (event) => {
      this.#update({ members: new Map(this.#state.members).set(event.user.id, event.user) });
    },
  };

  reset(): void {
    this.#update(EMPTY);
  }

  #update(change: Partial<ChatState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
  }
}

/** Members sorted for the member list: present people first, then by name (Turkish collation). */
export function sortMembers(state: ChatState): User[] {
  const collator = new Intl.Collator('tr', { sensitivity: 'base' });
  const present = (u: User) => (state.presence.has(u.id) ? 0 : 1);
  return [...state.members.values()].sort(
    (a, b) => present(a) - present(b) || collator.compare(a.displayName, b.displayName),
  );
}
