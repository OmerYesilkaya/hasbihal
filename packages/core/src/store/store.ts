import {
  TYPING_TTL_MS,
  type DurableEvent,
  type Message,
  type PresenceStatus,
  type Room,
  type RoomWithState,
  type User,
} from '@hasbihal/protocol';

/** A room as this member sees it: unread state kept up to date by events (A28 badges). */
export type RoomEntry = RoomWithState;

/** The client's view of the shared state, fed by HTTP loads and the gateway (ARCHITECTURE §4.3). */
export interface ChatState {
  me: User | null;
  /** By id. Members are never deleted from here: departed members' messages still need them (A42). */
  members: ReadonlyMap<string, User>;
  /** Everyone not listed is offline. */
  presence: ReadonlyMap<string, PresenceStatus>;
  rooms: ReadonlyMap<string, RoomEntry>;
  /** Loaded messages per room, by id. Use `roomMessages` for display order. */
  messages: ReadonlyMap<string, ReadonlyMap<string, Message>>;
  /** Per room: who is typing, until when (ms since epoch). See `typingIn`. */
  typing: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

const EMPTY: ChatState = {
  me: null,
  members: new Map(),
  presence: new Map(),
  rooms: new Map(),
  messages: new Map(),
  typing: new Map(),
};

/** Server order: creation time, then id (ARCHITECTURE §3.3). */
export function compareMessages(a: Message, b: Message): number {
  return a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}

/** Whether a message would count toward this member's unread badge, and as a mention. */
function unreadWeight(
  message: Message,
  meId: string | undefined,
): { unread: number; mention: number } {
  if (message.authorId === meId || message.deletedAt) return { unread: 0, mention: 0 };
  const mention =
    message.mentionsEveryone || (meId !== undefined && message.mentions.includes(meId)) ? 1 : 0;
  return { unread: 1, mention };
}

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

  /** The room list with unread counts, from `GET /rooms` (every welcome). Authoritative. */
  setRooms(rooms: readonly RoomEntry[]): void {
    this.#update({ rooms: new Map(rooms.map((r) => [r.id, r])) });
  }

  /** After a resync: loaded history may have gaps, so drop it; open rooms load again. */
  forgetMessages(): void {
    this.#update({ messages: new Map() });
  }

  /** A page of history from `GET /rooms/:id/messages`. Doesn't touch unread counts. */
  addMessages(roomId: string, messages: readonly Message[]): void {
    const map = new Map(this.#state.messages.get(roomId));
    for (const message of messages) map.set(message.id, message);
    this.#update({ messages: new Map(this.#state.messages).set(roomId, map) });
  }

  /**
   * This member's read marker moved (here or on another device). Unread is recounted from the
   * loaded messages after it: precise for the open room; `setRooms` corrects the rest on reconnect.
   */
  setReadMarker(roomId: string, messageId: string): void {
    const room = this.#state.rooms.get(roomId);
    if (!room) return;
    const loaded = this.#state.messages.get(roomId);
    const marker = loaded?.get(messageId);
    let unreadCount = 0;
    let unreadMentionCount = 0;
    if (loaded && marker) {
      for (const message of loaded.values()) {
        if (compareMessages(message, marker) <= 0) continue;
        const weight = unreadWeight(message, this.#state.me?.id);
        unreadCount += weight.unread;
        unreadMentionCount += weight.mention;
      }
    }
    this.#update({
      rooms: new Map(this.#state.rooms).set(roomId, {
        ...room,
        lastReadMessageId: messageId,
        unreadCount,
        unreadMentionCount,
      }),
    });
  }

  /** Someone is typing; shown for `TYPING_TTL_MS` unless repeated. */
  setTyping(roomId: string, userId: string, now = Date.now()): void {
    const room = new Map(this.#state.typing.get(roomId));
    room.set(userId, now + TYPING_TTL_MS);
    this.#update({ typing: new Map(this.#state.typing).set(roomId, room) });
  }

  /** A message from someone ends their typing indicator at once. */
  #stopTyping(roomId: string, userId: string): void {
    const room = this.#state.typing.get(roomId);
    if (!room?.has(userId)) return;
    const next = new Map(room);
    next.delete(userId);
    this.#update({ typing: new Map(this.#state.typing).set(roomId, next) });
  }

  /** Applies a durable event. Idempotent: replaying one around a reconnect changes nothing. */
  apply(event: DurableEvent): void {
    // Typed per event: a new event type doesn't compile until it has a handler below.
    (this.#handlers[event.type] as (e: DurableEvent) => void)(event);
  }

  readonly #handlers: {
    [T in DurableEvent['type']]: (event: Extract<DurableEvent, { type: T }>) => void;
  } = {
    member_joined: (event) => {
      this.#update({ members: new Map(this.#state.members).set(event.user.id, event.user) });
    },
    room_created: (event) => {
      if (this.#state.rooms.has(event.room.id)) return;
      this.#putRoom(event.room, { lastReadMessageId: null, unreadCount: 0, unreadMentionCount: 0 });
    },
    room_updated: (event) => {
      const current = this.#state.rooms.get(event.room.id);
      this.#putRoom(
        event.room,
        current ?? { lastReadMessageId: null, unreadCount: 0, unreadMentionCount: 0 },
      );
    },
    room_deleted: (event) => {
      const rooms = new Map(this.#state.rooms);
      const messages = new Map(this.#state.messages);
      rooms.delete(event.roomId);
      messages.delete(event.roomId);
      this.#update({ rooms, messages });
    },
    message_created: (event) => {
      const { message } = event;
      this.#stopTyping(message.roomId, message.authorId);
      const known = this.#state.messages.get(message.roomId)?.has(message.id) ?? false;
      this.addMessages(message.roomId, [message]);
      const room = this.#state.rooms.get(message.roomId);
      if (known || !room) return; // counted already, or a room we don't list
      const weight = unreadWeight(message, this.#state.me?.id);
      if (!weight.unread) return;
      this.#update({
        rooms: new Map(this.#state.rooms).set(room.id, {
          ...room,
          unreadCount: room.unreadCount + weight.unread,
          unreadMentionCount: room.unreadMentionCount + weight.mention,
        }),
      });
    },
    message_updated: (event) => {
      this.addMessages(event.message.roomId, [event.message]);
    },
    reaction_added: (event) => {
      this.#editReactions(event.roomId, event.messageId, event.emoji, (ids) =>
        ids.includes(event.userId) ? ids : [...ids, event.userId],
      );
    },
    reaction_removed: (event) => {
      this.#editReactions(event.roomId, event.messageId, event.emoji, (ids) =>
        ids.filter((id) => id !== event.userId),
      );
    },
  };

  reset(): void {
    this.#update(EMPTY);
  }

  #putRoom(
    room: Room,
    state: Pick<RoomEntry, 'lastReadMessageId' | 'unreadCount' | 'unreadMentionCount'>,
  ): void {
    const entry: RoomEntry = {
      ...room,
      lastReadMessageId: state.lastReadMessageId,
      unreadCount: state.unreadCount,
      unreadMentionCount: state.unreadMentionCount,
    };
    this.#update({ rooms: new Map(this.#state.rooms).set(room.id, entry) });
  }

  /** Changes who reacted with one emoji on a loaded message; unloaded messages arrive fresh later. */
  #editReactions(
    roomId: string,
    messageId: string,
    emoji: string,
    change: (userIds: string[]) => string[],
  ): void {
    const message = this.#state.messages.get(roomId)?.get(messageId);
    if (!message) return;
    const existing = message.reactions.find((r) => r.emoji === emoji);
    const userIds = change(existing?.userIds ?? []);
    const reactions = existing
      ? message.reactions
          .map((r) => (r.emoji === emoji ? { emoji, userIds } : r))
          .filter((r) => r.userIds.length > 0)
      : userIds.length
        ? [...message.reactions, { emoji, userIds }]
        : message.reactions;
    this.addMessages(roomId, [{ ...message, reactions }]);
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

/** The sidebar: active rooms by position, archived ones left out. */
export function activeRooms(state: ChatState): RoomEntry[] {
  return [...state.rooms.values()]
    .filter((r) => !r.archivedAt)
    .sort((a, b) => a.position - b.position);
}

/** Who is typing in a room right now, excluding expired entries. */
export function typingIn(state: ChatState, roomId: string, now = Date.now()): string[] {
  return [...(state.typing.get(roomId) ?? [])]
    .filter(([, until]) => until > now)
    .map(([userId]) => userId);
}

/** A room's loaded messages in display order. */
export function roomMessages(state: ChatState, roomId: string): Message[] {
  return [...(state.messages.get(roomId)?.values() ?? [])].sort(compareMessages);
}
