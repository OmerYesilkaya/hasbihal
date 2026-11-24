import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_PREFS, type Message, type User } from '@hasbihal/protocol';
import { activeRooms, ChatStore, hangoutOf, roomMessages, sortMembers, typingIn } from './store.ts';

const user = (id: string, displayName: string): User => ({
  id,
  username: displayName.toLowerCase(),
  displayName,
  avatarColor: 0,
  avatarFileId: null,
  role: 'member',
  createdAt: '2026-11-15T10:00:00.000Z',
  removedAt: null,
});
const ayse = user('0192f0c4-7b5e-7c8e-9a3b-000000000001', 'Ayşe');
const cem = user('0192f0c4-7b5e-7c8e-9a3b-000000000002', 'Cem');
const ismail = user('0192f0c4-7b5e-7c8e-9a3b-000000000003', 'İsmail');

describe('ChatStore', () => {
  it('applies member_joined idempotently', () => {
    const store = new ChatStore();
    store.apply({ type: 'member_joined', user: ayse });
    const before = store.getSnapshot();
    store.apply({ type: 'member_joined', user: ayse });
    expect([...store.getSnapshot().members.values()]).toEqual([...before.members.values()]);
  });

  it('keeps members that joined while a full load was in flight', () => {
    const store = new ChatStore();
    store.apply({ type: 'member_joined', user: cem }); // arrived during the load
    store.setMembers([ayse]); // the load, taken before Cem joined
    expect(new Set(store.getSnapshot().members.keys())).toEqual(new Set([ayse.id, cem.id]));
  });

  it('notifies only on change and gives a new snapshot each time', () => {
    const store = new ChatStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.setPresence(ayse.id, 'available');
    const snapshot = store.getSnapshot();
    store.setPresence(ayse.id, 'available');
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(snapshot);
    store.setPresence(ayse.id, 'offline');
    expect(store.getSnapshot().presence.has(ayse.id)).toBe(false);
  });

  it('sorts present members first, then by Turkish alphabetical order', () => {
    const store = new ChatStore();
    store.setMembers([ismail, cem, ayse]);
    store.setPresence(ismail.id, 'busy');
    // İsmail is present; Ayşe and Cem are offline, in Turkish order.
    expect(sortMembers(store.getSnapshot()).map((u) => u.displayName)).toEqual([
      'İsmail',
      'Ayşe',
      'Cem',
    ]);
  });
});

describe('ChatStore rooms and messages', () => {
  const me = user('0192f0c4-7b5e-7c8e-9a3b-0000000000aa', 'Ben');
  const roomId = '0192f0c4-7b5e-7c8e-9a3b-0000000000b1';
  const room = {
    id: roomId,
    name: 'Salon',
    topic: null,
    position: 1,
    createdAt: '2026-11-15T10:00:00.000Z',
    archivedAt: null,
    mahremMemberIds: [] as string[],
  };
  let n = 0;
  const message = (authorId: string, extra: Partial<Message> = {}): Message => ({
    id: `0192f0c4-7b5e-7c8e-9a3b-${String(++n).padStart(12, '0')}`,
    roomId,
    authorId,
    body: 'merhaba',
    replyTo: null,
    mentions: [],
    mentionsEveryone: false,
    reactions: [],
    attachments: [],
    previews: [],
    createdAt: `2026-11-15T10:00:${String(n).padStart(2, '0')}.000Z`,
    editedAt: null,
    deletedAt: null,
    ...extra,
  });

  function setup() {
    const store = new ChatStore();
    store.setMe(me);
    store.apply({ type: 'room_created', room });
    return store;
  }

  it('counts unread messages by others once, even when an event repeats', () => {
    const store = setup();
    const fromAyse = message(ayse.id, { mentions: [me.id] });
    store.apply({ type: 'message_created', message: fromAyse });
    store.apply({ type: 'message_created', message: fromAyse }); // replayed around a reconnect
    store.apply({ type: 'message_created', message: message(me.id) }); // my own
    expect(store.getSnapshot().rooms.get(roomId)).toMatchObject({
      unreadCount: 1,
      unreadMentionCount: 1,
    });
  });

  it('recounts unread from the read marker', () => {
    const store = setup();
    const first = message(ayse.id);
    const second = message(cem.id, { mentionsEveryone: true });
    store.apply({ type: 'message_created', message: first });
    store.apply({ type: 'message_created', message: second });
    store.setReadMarker(roomId, first.id);
    expect(store.getSnapshot().rooms.get(roomId)).toMatchObject({
      unreadCount: 1,
      unreadMentionCount: 1,
      lastReadMessageId: first.id,
    });
    store.setReadMarker(roomId, second.id);
    expect(store.getSnapshot().rooms.get(roomId)).toMatchObject({
      unreadCount: 0,
      unreadMentionCount: 0,
    });
  });

  it('applies reactions as set operations', () => {
    const store = setup();
    const m = message(ayse.id);
    store.apply({ type: 'message_created', message: m });
    const reaction = { roomId, messageId: m.id, userId: cem.id, emoji: '👍' };
    store.apply({ type: 'reaction_added', ...reaction });
    store.apply({ type: 'reaction_added', ...reaction });
    expect(roomMessages(store.getSnapshot(), roomId)[0]?.reactions).toEqual([
      { emoji: '👍', userIds: [cem.id] },
    ]);
    store.apply({ type: 'reaction_removed', ...reaction });
    store.apply({ type: 'reaction_removed', ...reaction });
    expect(roomMessages(store.getSnapshot(), roomId)[0]?.reactions).toEqual([]);
  });

  it('replaces edited and deleted messages, keeps room state on rename, and forgets deleted rooms', () => {
    const store = setup();
    const m = message(ayse.id);
    store.apply({ type: 'message_created', message: m });
    store.apply({
      type: 'message_updated',
      message: { ...m, body: '', deletedAt: '2026-11-15T11:00:00.000Z' },
    });
    expect(roomMessages(store.getSnapshot(), roomId)[0]?.body).toBe('');

    store.apply({ type: 'room_updated', room: { ...room, name: 'Oturma odası' } });
    expect(store.getSnapshot().rooms.get(roomId)).toMatchObject({
      name: 'Oturma odası',
      unreadCount: 1,
    });

    store.apply({ type: 'room_deleted', roomId });
    expect(store.getSnapshot().rooms.has(roomId)).toBe(false);
    expect(store.getSnapshot().messages.has(roomId)).toBe(false);
  });

  it('lists active rooms by position and messages in server order', () => {
    const store = setup();
    store.apply({
      type: 'room_created',
      room: {
        ...room,
        id: ayse.id,
        name: 'Arşiv',
        position: 0,
        archivedAt: '2026-11-15T10:00:00.000Z',
      },
    });
    expect(activeRooms(store.getSnapshot()).map((r) => r.name)).toEqual(['Salon']);
    const later = message(ayse.id);
    const earlier = message(ayse.id, { createdAt: '2026-11-15T09:00:00.000Z' });
    store.addMessages(roomId, [later, earlier]);
    expect(roomMessages(store.getSnapshot(), roomId).map((m) => m.id)).toEqual([
      earlier.id,
      later.id,
    ]);
  });
  it('lists this member’s favourite rooms first, each part by position', () => {
    const store = setup();
    const other = (id: string, name: string, position: number) => ({
      ...room,
      id: `0192f0c4-7b5e-7c8e-9a3b-0000000000${id}`,
      name,
      position,
    });
    store.apply({ type: 'room_created', room: other('c1', 'Mutfak', 0) });
    store.apply({ type: 'room_created', room: other('c2', 'Bahçe', 2) });
    store.apply({ type: 'room_created', room: other('c3', 'Avlu', 3) });
    const names = () => activeRooms(store.getSnapshot()).map((r) => r.name);
    expect(names()).toEqual(['Mutfak', 'Salon', 'Bahçe', 'Avlu']);

    const favorite = { ...DEFAULT_ROOM_PREFS, favorite: true };
    store.setRoomPrefs('0192f0c4-7b5e-7c8e-9a3b-0000000000c3', favorite);
    store.setRoomPrefs(roomId, favorite);
    expect(names()).toEqual(['Salon', 'Avlu', 'Mutfak', 'Bahçe']);
  });
});

describe('ChatStore typing', () => {
  const roomId = '0192f0c4-7b5e-7c8e-9a3b-0000000000b1';

  it('shows typing for a while, and ends it when their message arrives', () => {
    const store = new ChatStore();
    store.setTyping(roomId, ayse.id, 1_000);
    expect(typingIn(store.getSnapshot(), roomId, 2_000)).toEqual([ayse.id]);
    expect(typingIn(store.getSnapshot(), roomId, 1_000 + 7_000)).toEqual([]);

    store.setTyping(roomId, ayse.id);
    store.apply({
      type: 'message_created',
      message: {
        id: '0192f0c4-7b5e-7c8e-9a3b-0000000000c1',
        roomId,
        authorId: ayse.id,
        body: 'tamam',
        replyTo: null,
        mentions: [],
        mentionsEveryone: false,
        reactions: [],
        attachments: [],
        previews: [],
        createdAt: '2026-11-15T10:00:00.000Z',
        editedAt: null,
        deletedAt: null,
      },
    });
    expect(typingIn(store.getSnapshot(), roomId)).toEqual([]);
  });
});

describe('ChatStore hangouts', () => {
  const salon = '0192f0c4-7b5e-7c8e-9a3b-0000000000b1';
  const joinedAt = '2026-11-15T10:00:00.000Z';

  it('tracks who is in which hangout', () => {
    const store = new ChatStore();
    store.setHangouts({
      [salon]: [{ userId: ayse.id, joinedAt, camera: false, screenShare: false }],
    });
    expect(hangoutOf(store.getSnapshot(), ayse.id)).toBe(salon);
    store.setHangout(salon, []);
    expect(store.getSnapshot().hangouts.has(salon)).toBe(false);
    expect(hangoutOf(store.getSnapshot(), ayse.id)).toBeUndefined();
  });
});
