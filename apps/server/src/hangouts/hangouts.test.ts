import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hasbihal/core';
import { ApiError, HangoutToken, NudgeResult, Room, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
let room: Room;

beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
  room = Room.parse(
    (await h.request('POST', '/rooms', admin.tokens.accessToken, { name: 'Salon' })).json(),
  );
});
afterAll(async () => {
  await h.close();
});

const as = (who: SignedIn) => who.tokens.accessToken;

/** Sends a webhook signed the way LiveKit signs them (dev-mode key and secret). */
async function webhook(event: Record<string, unknown>, secret = 'secret') {
  const body = JSON.stringify({
    id: newId(),
    createdAt: String(Math.floor(Date.now() / 1000)),
    ...event,
  });
  const token = new AccessToken('devkey', secret);
  token.sha256 = createHash('sha256').update(body).digest('base64');
  return h.app.inject({
    method: 'POST',
    url: '/hooks/livekit',
    headers: { 'content-type': 'application/webhook+json', authorization: await token.toJwt() },
    payload: body,
  });
}

const joined = (roomId: string, userId: string) =>
  webhook({
    event: 'participant_joined',
    room: { name: roomId },
    participant: { identity: userId, joinedAt: String(Math.floor(Date.now() / 1000)) },
  });

describe('joining (ARCHITECTURE §6.1)', () => {
  it('gives a LiveKit token for the room, as the user', async () => {
    const member = await h.signUp();
    const res = await h.request('POST', `/rooms/${room.id}/hangout/token`, as(member));
    const { url, token } = HangoutToken.parse(res.json());
    expect(url).toBe('ws://localhost:7880');
    const claims = decodeJwt(token);
    expect(claims.sub).toBe(member.user.id);
    expect(claims.video).toMatchObject({
      room: room.id,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('refuses archived rooms', async () => {
    const archived = Room.parse(
      (await h.request('POST', '/rooms', as(admin), { name: 'Eski' })).json(),
    );
    await h.request('POST', `/rooms/${archived.id}/archive`, as(admin));
    expect(
      (await h.request('POST', `/rooms/${archived.id}/hangout/token`, as(admin))).statusCode,
    ).toBe(409);
  });
});

describe('who is in the hangout (ARCHITECTURE §6.3)', () => {
  it('follows LiveKit webhooks and tells everyone, with "started" for the first joiner', async () => {
    const ayse = await h.signUp();
    const kerem = await h.signUp();
    const busy = await h.signUp();
    const watcher = await h.connect(as(kerem));
    const busyClient = await h.connect(as(busy));
    await watcher.waitFor('welcome');
    await busyClient.waitFor('welcome');
    busyClient.send({ type: 'set_presence', mode: 'busy' });
    await busyClient.waitFor('presence', (m) => m.userId === busy.user.id && m.status === 'busy');

    expect((await joined(room.id, ayse.user.id)).statusCode).toBe(204);
    await watcher.waitFor(
      'hangout',
      (m) => m.roomId === room.id && m.participants.some((p) => p.userId === ayse.user.id),
    );
    await watcher.waitFor(
      'hangout_started',
      (m) => m.roomId === room.id && m.userId === ayse.user.id,
    );

    await webhook({
      event: 'track_published',
      room: { name: room.id },
      participant: { identity: ayse.user.id },
      track: { source: 'CAMERA' },
    });
    await watcher.waitFor('hangout', (m) =>
      m.participants.some((p) => p.userId === ayse.user.id && p.camera),
    );

    // Someone connecting now sees it in the welcome.
    const late = await h.connect(as(admin));
    expect((await late.waitFor('welcome')).hangouts[room.id]?.map((p) => p.userId)).toEqual([
      ayse.user.id,
    ]);

    await webhook({
      event: 'participant_left',
      room: { name: room.id },
      participant: { identity: ayse.user.id },
    });
    await watcher.waitFor('hangout', (m) => m.roomId === room.id && m.participants.length === 0);

    // Busy mode (A19): no "hangout started" for them.
    expect(busyClient.messages.filter((m) => m.type === 'hangout_started')).toHaveLength(0);
    for (const c of [watcher, busyClient, late]) c.ws.terminate();
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await webhook(
      {
        event: 'participant_joined',
        room: { name: room.id },
        participant: { identity: admin.user.id },
      },
      'wrong',
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('nudges (A13, A19)', () => {
  it('delivers a nudge, then holds back repeats for a minute', async () => {
    const from = await h.signUp();
    const to = await h.signUp();
    const client = await h.connect(as(to));
    await client.waitFor('welcome');
    const res = await h.request('POST', '/nudges', as(from), {
      toUserId: to.user.id,
      roomId: room.id,
    });
    expect(NudgeResult.parse(res.json())).toEqual({ delivered: true });
    await client.waitFor('nudge', (m) => m.fromUserId === from.user.id && m.roomId === room.id);
    const again = await h.request('POST', '/nudges', as(from), {
      toUserId: to.user.id,
      roomId: room.id,
    });
    expect(again.statusCode).toBe(429);
    client.ws.terminate();
  });

  it('says when nobody received it, and refuses busy members and yourself', async () => {
    const from = await h.signUp();
    const offline = await h.signUp();
    expect(
      NudgeResult.parse(
        (
          await h.request('POST', '/nudges', as(from), {
            toUserId: offline.user.id,
            roomId: room.id,
          })
        ).json(),
      ),
    ).toEqual({
      delivered: false,
    });

    const busy = await h.signUp();
    const client = await h.connect(as(busy));
    await client.waitFor('welcome');
    client.send({ type: 'set_presence', mode: 'busy' });
    await client.waitFor('presence', (m) => m.status === 'busy');
    const refused = await h.request('POST', '/nudges', as(from), {
      toUserId: busy.user.id,
      roomId: room.id,
    });
    expect(refused.statusCode).toBe(409);
    expect(ApiError.parse(refused.json()).error.issues?.[0]?.code).toBe('recipient_busy');
    expect(
      (await h.request('POST', '/nudges', as(from), { toUserId: from.user.id, roomId: room.id }))
        .statusCode,
    ).toBe(400);
    client.ws.terminate();
  });
});
