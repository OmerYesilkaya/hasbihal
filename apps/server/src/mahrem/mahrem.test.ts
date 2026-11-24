import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hasbihal/core';
import { KnockResult, Room, RoomList, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
/** Who LiveKit was asked to drop from a call, as `roomId:userId`. */
const removed: string[] = [];

beforeAll(async () => {
  h = await startHarness({
    livekitRooms: {
      list: () => Promise.resolve(new Map()),
      remove: (roomId, userId) => {
        removed.push(`${roomId}:${userId}`);
        return Promise.resolve();
      },
    },
  });
  admin = await h.signUp('admin');
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  removed.length = 0;
});

const as = (who: SignedIn) => who.tokens.accessToken;

const newRoom = async (name = `Oda ${newId().slice(-4)}`) =>
  Room.parse((await h.request('POST', '/rooms', as(admin), { name })).json());

const setList = (room: Room, who: SignedIn, members: SignedIn[]) =>
  h.request('PUT', `/rooms/${room.id}/mahrem`, as(who), {
    memberIds: members.map((m) => m.user.id),
  });

const token = (room: Room, who: SignedIn) =>
  h.request('POST', `/rooms/${room.id}/hangout/token`, as(who));

const knock = (room: Room, who: SignedIn) =>
  h.request('POST', `/rooms/${room.id}/mahrem/knock`, as(who));

const answer = (room: Room, who: SignedIn, knocker: SignedIn, admit: boolean) =>
  h.request('POST', `/rooms/${room.id}/mahrem/knocks/${knocker.user.id}`, as(who), { admit });

/** Sends a webhook signed the way LiveKit signs them (dev-mode key and secret). */
async function webhook(event: Record<string, unknown>) {
  const body = JSON.stringify({
    id: newId(),
    createdAt: String(Math.floor(Date.now() / 1000)),
    ...event,
  });
  const signer = new AccessToken('devkey', 'secret');
  signer.sha256 = createHash('sha256').update(body).digest('base64');
  const res = await h.app.inject({
    method: 'POST',
    url: '/hooks/livekit',
    headers: { 'content-type': 'application/webhook+json', authorization: await signer.toJwt() },
    payload: body,
  });
  expect(res.statusCode).toBe(204);
}

const joins = (room: Room, who: SignedIn) =>
  webhook({
    event: 'participant_joined',
    room: { name: room.id },
    participant: { identity: who.user.id, joinedAt: String(Math.floor(Date.now() / 1000)) },
  });

const leaves = (room: Room, who: SignedIn) =>
  webhook({
    event: 'participant_left',
    room: { name: room.id },
    participant: { identity: who.user.id },
  });

describe('the list (A55)', () => {
  it('any member turns it on with themselves on it, and everyone sees the room become Mahrem', async () => {
    const room = await newRoom();
    expect(room.mahremMemberIds).toEqual([]);
    const sister = await h.signUp();
    const brother = await h.signUp();
    const cousin = await h.signUp();
    const watching = await h.connect(as(cousin));
    await watching.waitFor('welcome');

    // Not without themselves on it.
    expect((await setList(room, sister, [brother])).statusCode).toBe(400);

    const res = await setList(room, sister, [sister, brother]);
    expect(res.statusCode).toBe(200);
    expect(Room.parse(res.json()).mahremMemberIds).toEqual([sister.user.id, brother.user.id]);
    await watching.waitFor(
      'event',
      (m) => m.event.type === 'room_updated' && m.event.room.mahremMemberIds.length === 2,
    );
    const listed = RoomList.parse((await h.request('GET', '/rooms', as(cousin))).json());
    expect(listed.rooms.find((r) => r.id === room.id)?.mahremMemberIds).toEqual([
      sister.user.id,
      brother.user.id,
    ]);
  });

  it('only people on the list change it or turn it off: admins have no override', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const brother = await h.signUp();
    await setList(room, sister, [sister]);

    expect((await setList(room, admin, [sister, admin])).statusCode).toBe(403);
    expect((await h.request('DELETE', `/rooms/${room.id}/mahrem`, as(admin))).statusCode).toBe(403);
    expect((await setList(room, brother, [sister, brother])).statusCode).toBe(403);

    expect((await setList(room, sister, [sister, brother])).statusCode).toBe(200);
    // Brother takes himself off; he can't change it any more.
    expect((await setList(room, brother, [sister])).statusCode).toBe(200);
    expect((await setList(room, brother, [sister, brother])).statusCode).toBe(403);

    const off = await h.request('DELETE', `/rooms/${room.id}/mahrem`, as(sister));
    expect(Room.parse(off.json()).mahremMemberIds).toEqual([]);
    // Open again: anyone may turn it on.
    expect((await setList(room, brother, [brother])).statusCode).toBe(200);
  });

  it('tells everyone on the list before or after who changed what, except the one who did', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const brother = await h.signUp();
    const mother = await h.signUp();
    await setList(room, sister, [sister, brother]);
    const brothers = await h.connect(as(brother));
    const sisters = await h.connect(as(sister));
    await brothers.waitFor('welcome');
    await sisters.waitFor('welcome');

    await setList(room, sister, [sister, mother]);
    const told = await brothers.waitFor('mahrem_changed', (m) => m.roomId === room.id);
    expect(told).toMatchObject({
      byUserId: sister.user.id,
      memberIds: [sister.user.id, mother.user.id],
      added: [mother.user.id],
      removed: [brother.user.id],
    });
    expect(sisters.messages.some((m) => m.type === 'mahrem_changed')).toBe(false);
  });

  it('refuses people who are not members, and archived rooms', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const res = await h.request('PUT', `/rooms/${room.id}/mahrem`, as(sister), {
      memberIds: [sister.user.id, newId()],
    });
    expect(res.statusCode).toBe(400);
    await h.request('POST', `/rooms/${room.id}/archive`, as(admin));
    expect((await setList(room, sister, [sister])).statusCode).toBe(409);
  });

  it('takes members removed from Hasbihal off it; an empty list opens the room', async () => {
    const room = await newRoom();
    const leaving = await h.signUp();
    await setList(room, leaving, [leaving]);
    await h.request('POST', `/admin/users/${leaving.user.id}/remove`, as(admin));
    const listed = RoomList.parse((await h.request('GET', '/rooms', as(admin))).json());
    expect(listed.rooms.find((r) => r.id === room.id)?.mahremMemberIds).toEqual([]);
  });
});

describe('the call (A55)', () => {
  it('gives call tokens only to the list, admins included', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const cousin = await h.signUp();
    expect((await token(room, cousin)).statusCode).toBe(200); // open
    await setList(room, sister, [sister]);
    expect((await token(room, sister)).statusCode).toBe(200);
    expect((await token(room, cousin)).statusCode).toBe(403);
    expect((await token(room, admin)).statusCode).toBe(403);
  });

  it('turning it on, or taking someone off, removes them from the call', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const brother = await h.signUp();
    const cousin = await h.signUp();
    await joins(room, sister);
    await joins(room, brother);
    await joins(room, cousin);

    await setList(room, sister, [sister, brother]);
    expect(removed).toEqual([`${room.id}:${cousin.user.id}`]);

    await leaves(room, cousin); // what LiveKit reports after removing him
    removed.length = 0;
    await setList(room, sister, [sister]);
    expect(removed).toEqual([`${room.id}:${brother.user.id}`]);
  });

  it('removes anyone LiveKit lets in with a token from before', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const cousin = await h.signUp();
    await setList(room, sister, [sister]);
    await joins(room, sister);
    await joins(room, cousin);
    expect(removed).toEqual([`${room.id}:${cousin.user.id}`]);
  });
});

describe('knocking (A55)', () => {
  it('tells the list; one of them lets the knocker in for one call', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const brother = await h.signUp();
    const cousin = await h.signUp();
    await setList(room, sister, [sister, brother]);
    const sisters = await h.connect(as(sister));
    const brothers = await h.connect(as(brother));
    const cousins = await h.connect(as(cousin));
    for (const c of [sisters, brothers, cousins]) await c.waitFor('welcome');

    // The list doesn't knock, and nobody knocks on an open room.
    expect((await knock(room, sister)).statusCode).toBe(409);
    expect((await knock(await newRoom(), cousin)).statusCode).toBe(409);

    const knocked = await knock(room, cousin);
    expect(KnockResult.parse(knocked.json())).toEqual({ delivered: true });
    await sisters.waitFor('knock', (m) => m.roomId === room.id && m.userId === cousin.user.id);
    await brothers.waitFor('knock', (m) => m.userId === cousin.user.id);
    expect((await knock(room, cousin)).statusCode).toBe(429);

    // Only the list answers, and only once.
    expect((await answer(room, cousin, cousin, true)).statusCode).toBe(403);
    expect((await answer(room, sister, cousin, true)).statusCode).toBe(204);
    expect((await answer(room, brother, cousin, false)).statusCode).toBe(409);
    for (const c of [cousins, brothers])
      expect(await c.waitFor('knock_answered', (m) => m.userId === cousin.user.id)).toMatchObject({
        roomId: room.id,
        admit: true,
        byUserId: sister.user.id,
      });

    // In for this call: joining doesn't get them removed, and changing the list keeps them.
    expect((await token(room, cousin)).statusCode).toBe(200);
    await joins(room, cousin);
    await setList(room, sister, [sister]);
    expect(removed).toEqual([]);

    // Once they leave, the pass is gone.
    await leaves(room, cousin);
    expect((await token(room, cousin)).statusCode).toBe(403);
  });

  it('turned away: no way in', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const cousin = await h.signUp();
    await setList(room, sister, [sister]);
    const cousins = await h.connect(as(cousin));
    await cousins.waitFor('welcome');
    // Nobody on the list is online: the knock reaches no one, but can still be answered later.
    expect(KnockResult.parse((await knock(room, cousin)).json())).toEqual({ delivered: false });
    expect((await answer(room, sister, cousin, false)).statusCode).toBe(204);
    await cousins.waitFor('knock_answered', (m) => m.userId === cousin.user.id && !m.admit);
    expect((await token(room, cousin)).statusCode).toBe(403);
  });
});

describe('events in a Mahrem room (A15, A55)', () => {
  it('invite only people on the list', async () => {
    const room = await newRoom();
    const sister = await h.signUp();
    const cousin = await h.signUp();
    await setList(room, sister, [sister]);
    const save = (inviteeIds: string[]) =>
      h.request('POST', '/events', as(admin), {
        roomId: room.id,
        title: 'Arapça',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        durationMin: 60,
        inviteeIds,
      });
    expect((await save([sister.user.id, cousin.user.id])).statusCode).toBe(400);
    expect((await save([sister.user.id])).statusCode).toBe(201);
  });
});
