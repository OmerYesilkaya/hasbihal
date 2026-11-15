import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hasbihal/core';
import { ApiError, Message, MessagePage, Room, RoomList, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
let ayse: SignedIn;
let kerem: SignedIn;

beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
  ayse = await h.signUp();
  kerem = await h.signUp();
});

afterAll(async () => {
  await h.close();
});

const as = (who: SignedIn) => who.tokens.accessToken;

async function createRoom(name = `Oda ${newId().slice(-4)}`): Promise<Room> {
  const res = await h.request('POST', '/rooms', as(admin), { name });
  expect(res.statusCode, res.body).toBe(201);
  return Room.parse(res.json());
}

async function send(
  who: SignedIn,
  roomId: string,
  body: string,
  extra: object = {},
): Promise<Message> {
  const res = await h.request('POST', `/rooms/${roomId}/messages`, as(who), {
    id: newId(),
    body,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return Message.parse(res.json());
}

async function roomState(who: SignedIn, roomId: string) {
  const res = await h.request('GET', '/rooms', as(who));
  return RoomList.parse(res.json()).rooms.find((r) => r.id === roomId);
}

const page = async (who: SignedIn, roomId: string, query = '') =>
  MessagePage.parse((await h.request('GET', `/rooms/${roomId}/messages${query}`, as(who))).json());

const code = (res: { json(): unknown }) => ApiError.parse(res.json()).error.code;

describe('rooms (A8, A12)', () => {
  it('lets admins create rooms that everyone sees, and not members', async () => {
    const room = await createRoom('Oturma odası');
    expect(room.name).toBe('Oturma odası');
    expect(await roomState(ayse, room.id)).toMatchObject({ unreadCount: 0, unreadMentionCount: 0 });
    const denied = await h.request('POST', '/rooms', as(ayse), { name: 'Benim odam' });
    expect(denied.statusCode).toBe(403);
  });

  it('appends new rooms at the end', async () => {
    const a = await createRoom();
    const b = await createRoom();
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('renames, changes the topic, and announces it live', async () => {
    const room = await createRoom();
    const client = await h.connect(as(ayse));
    await client.waitFor('welcome');
    const res = await h.request('PATCH', `/rooms/${room.id}`, as(admin), {
      name: 'Mutfak',
      topic: 'Yemek tarifleri',
    });
    expect(Room.parse(res.json())).toMatchObject({ name: 'Mutfak', topic: 'Yemek tarifleri' });
    await client.waitFor(
      'event',
      (m) => m.event.type === 'room_updated' && m.event.room.name === 'Mutfak',
    );
    client.ws.terminate();
  });

  it('makes archived rooms read-only until unarchived', async () => {
    const room = await createRoom();
    await h.request('POST', `/rooms/${room.id}/archive`, as(admin));
    const refused = await h.request('POST', `/rooms/${room.id}/messages`, as(ayse), {
      id: newId(),
      body: 'merhaba',
    });
    expect(refused.statusCode).toBe(409);
    await h.request('POST', `/rooms/${room.id}/unarchive`, as(admin));
    await send(ayse, room.id, 'merhaba');
  });

  it('deletes a room with its messages', async () => {
    const room = await createRoom();
    await send(ayse, room.id, 'gidiyor');
    expect((await h.request('DELETE', `/rooms/${room.id}`, as(admin))).statusCode).toBe(204);
    expect((await h.request('GET', `/rooms/${room.id}/messages`, as(ayse))).statusCode).toBe(404);
  });
});

describe('messages (A22)', () => {
  it('sends, and delivers the message live to others', async () => {
    const room = await createRoom();
    const client = await h.connect(as(kerem));
    await client.waitFor('welcome');
    const message = await send(ayse, room.id, '**Merhaba** herkese');
    const event = await client.waitFor(
      'event',
      (m) => m.event.type === 'message_created' && m.event.message.id === message.id,
    );
    expect(event.event.type === 'message_created' && event.event.message.body).toBe(
      '**Merhaba** herkese',
    );
    client.ws.terminate();
  });

  it('treats a resend with the same id as a retry, not a new message', async () => {
    const room = await createRoom();
    const id = newId();
    const first = await h.request('POST', `/rooms/${room.id}/messages`, as(ayse), {
      id,
      body: 'bir kez',
    });
    const again = await h.request('POST', `/rooms/${room.id}/messages`, as(ayse), {
      id,
      body: 'bir kez',
    });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(Message.parse(again.json()).id).toBe(id);
    expect((await page(ayse, room.id)).messages).toHaveLength(1);
    // Someone else reusing the id is a collision.
    const stolen = await h.request('POST', `/rooms/${room.id}/messages`, as(kerem), {
      id,
      body: 'benim',
    });
    expect(stolen.statusCode).toBe(409);
  });

  it('orders history by server time, whatever the client clock says', async () => {
    const room = await createRoom();
    await send(ayse, room.id, 'önce');
    // A UUIDv7 whose embedded timestamp is in 1970: a client with a badly wrong clock.
    const skewed = await h.request('POST', `/rooms/${room.id}/messages`, as(ayse), {
      id: '01000000-0000-7000-8000-000000000001',
      body: 'sonra',
    });
    expect(skewed.statusCode).toBe(201);
    expect((await page(ayse, room.id)).messages.map((m) => m.body)).toEqual(['önce', 'sonra']);
  });

  it('pages back through history', async () => {
    const room = await createRoom();
    for (let i = 1; i <= 7; i++) await send(ayse, room.id, `mesaj ${String(i)}`);
    const latest = await page(ayse, room.id, '?limit=3');
    expect(latest.messages.map((m) => m.body)).toEqual(['mesaj 5', 'mesaj 6', 'mesaj 7']);
    expect(latest.hasMore).toBe(true);
    const older = await page(ayse, room.id, `?limit=3&before=${latest.messages[0]?.id ?? ''}`);
    expect(older.messages.map((m) => m.body)).toEqual(['mesaj 2', 'mesaj 3', 'mesaj 4']);
    const oldest = await page(ayse, room.id, `?limit=3&before=${older.messages[0]?.id ?? ''}`);
    expect(oldest).toMatchObject({ hasMore: false });
    expect(oldest.messages.map((m) => m.body)).toEqual(['mesaj 1']);
  });

  it('resolves @mentions and @everyone, ignoring unknown names and code', async () => {
    const room = await createRoom();
    const message = await send(
      ayse,
      room.id,
      `@${kerem.user.username} bak, \`@${admin.user.username}\` değil, @kimseyok @everyone`,
    );
    expect(message.mentions).toEqual([kerem.user.id]);
    expect(message.mentionsEveryone).toBe(true);
  });

  it('quotes the replied-to message, and only within the same room', async () => {
    const room = await createRoom();
    const original = await send(ayse, room.id, 'Akşam ne yiyoruz?');
    const reply = await send(kerem, room.id, 'Mantı!', { replyToId: original.id });
    expect(reply.replyTo).toEqual({
      id: original.id,
      authorId: ayse.user.id,
      excerpt: 'Akşam ne yiyoruz?',
      deleted: false,
    });

    const elsewhere = await createRoom();
    const res = await h.request('POST', `/rooms/${elsewhere.id}/messages`, as(kerem), {
      id: newId(),
      body: 'x',
      replyToId: original.id,
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets the author edit, marks it edited, and refuses others', async () => {
    const room = await createRoom();
    const message = await send(ayse, room.id, 'yanlış');
    const edited = Message.parse(
      (
        await h.request('PATCH', `/messages/${message.id}`, as(ayse), {
          body: `doğru @${kerem.user.username}`,
        })
      ).json(),
    );
    expect(edited.body).toBe(`doğru @${kerem.user.username}`);
    expect(edited.editedAt).not.toBeNull();
    expect(edited.mentions).toEqual([kerem.user.id]);
    const denied = await h.request('PATCH', `/messages/${message.id}`, as(kerem), {
      body: 'benim',
    });
    expect(denied.statusCode).toBe(403);
    expect(code(denied)).toBe('forbidden');
  });

  it('leaves a placeholder when deleted, and the reply quote shows it', async () => {
    const room = await createRoom();
    const original = await send(ayse, room.id, 'silinecek');
    await h.request(
      'PUT',
      `/messages/${original.id}/reactions/${encodeURIComponent('👍')}`,
      as(kerem),
    );
    await send(kerem, room.id, 'cevap', { replyToId: original.id });
    expect((await h.request('DELETE', `/messages/${original.id}`, as(kerem))).statusCode).toBe(403);
    expect((await h.request('DELETE', `/messages/${original.id}`, as(ayse))).statusCode).toBe(204);
    expect((await h.request('DELETE', `/messages/${original.id}`, as(ayse))).statusCode).toBe(204); // again: no-op

    const [deleted, reply] = (await page(ayse, room.id)).messages;
    expect(deleted).toMatchObject({ body: '', reactions: [], mentions: [] });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(reply?.replyTo).toMatchObject({ deleted: true, excerpt: '' });
    expect(
      (await h.request('PATCH', `/messages/${original.id}`, as(ayse), { body: 'geri' })).statusCode,
    ).toBe(409);
  });

  it('rejects empty and overlong messages', async () => {
    const room = await createRoom();
    for (const body of ['   ', 'x'.repeat(4001)]) {
      const res = await h.request('POST', `/rooms/${room.id}/messages`, as(ayse), {
        id: newId(),
        body,
      });
      expect(res.statusCode, String(body.length)).toBe(400);
    }
  });
});

describe('reactions', () => {
  it('adds once per person and emoji, removes, and rejects non-emoji', async () => {
    const room = await createRoom();
    const message = await send(ayse, room.id, 'tatile çıktık');
    const heart = `/messages/${message.id}/reactions/${encodeURIComponent('❤️')}`;
    await h.request('PUT', heart, as(kerem));
    await h.request('PUT', heart, as(kerem));
    await h.request('PUT', heart, as(admin));
    let [reloaded] = (await page(ayse, room.id)).messages;
    expect(reloaded?.reactions).toEqual([{ emoji: '❤️', userIds: [kerem.user.id, admin.user.id] }]);

    await h.request('DELETE', heart, as(kerem));
    [reloaded] = (await page(ayse, room.id)).messages;
    expect(reloaded?.reactions).toEqual([{ emoji: '❤️', userIds: [admin.user.id] }]);

    const bad = await h.request('PUT', `/messages/${message.id}/reactions/abc`, as(kerem));
    expect(bad.statusCode).toBe(400);
  });
});

describe('unread state', () => {
  it('counts messages by others after the read marker, and mentions separately', async () => {
    const room = await createRoom();
    await send(ayse, room.id, 'selam');
    const second = await send(ayse, room.id, `@${kerem.user.username} geliyor musun?`);
    expect(await roomState(kerem, room.id)).toMatchObject({
      unreadCount: 2,
      unreadMentionCount: 1,
    });
    expect(await roomState(ayse, room.id)).toMatchObject({ unreadCount: 0 }); // own messages

    await h.request('POST', `/rooms/${room.id}/read`, as(kerem), { messageId: second.id });
    expect(await roomState(kerem, room.id)).toMatchObject({
      unreadCount: 0,
      lastReadMessageId: second.id,
    });
  });

  it('never moves the read marker backwards', async () => {
    const room = await createRoom();
    const first = await send(ayse, room.id, 'bir');
    const second = await send(ayse, room.id, 'iki');
    await h.request('POST', `/rooms/${room.id}/read`, as(kerem), { messageId: second.id });
    await h.request('POST', `/rooms/${room.id}/read`, as(kerem), { messageId: first.id });
    expect((await roomState(kerem, room.id))?.lastReadMessageId).toBe(second.id);
  });

  it("tells the member's other devices when the marker moves", async () => {
    const room = await createRoom();
    const message = await send(ayse, room.id, 'oku beni');
    const otherDevice = await h.connect(as(kerem));
    await otherDevice.waitFor('welcome');
    await h.request('POST', `/rooms/${room.id}/read`, as(kerem), { messageId: message.id });
    await otherDevice.waitFor(
      'read_state',
      (m) => m.roomId === room.id && m.lastReadMessageId === message.id,
    );
    otherDevice.ws.terminate();
  });

  it("doesn't count history from before a member joined", async () => {
    const room = await createRoom();
    await send(ayse, room.id, 'eski mesaj');
    const newcomer = await h.signUp();
    expect(await roomState(newcomer, room.id)).toMatchObject({ unreadCount: 0 });
    await send(ayse, room.id, 'hoş geldin');
    expect(await roomState(newcomer, room.id)).toMatchObject({ unreadCount: 1 });
  });
});

describe('typing', () => {
  it('tells others, not the typist, at most every 2 seconds', async () => {
    const room = await createRoom();
    const watcher = await h.connect(as(ayse));
    const typist = await h.connect(as(kerem));
    await watcher.waitFor('welcome');
    await typist.waitFor('welcome');
    typist.send({ type: 'typing', roomId: room.id });
    typist.send({ type: 'typing', roomId: room.id });
    await watcher.waitFor('typing', (m) => m.roomId === room.id && m.userId === kerem.user.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(watcher.messages.filter((m) => m.type === 'typing')).toHaveLength(1);
    expect(typist.messages.filter((m) => m.type === 'typing')).toHaveLength(0);
    watcher.ws.terminate();
    typist.ws.terminate();
  });
});
