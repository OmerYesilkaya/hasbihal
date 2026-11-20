import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_PREFS, Message, Room, RoomList, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
let room: Room;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
  room = Room.parse((await h.request('POST', '/rooms', as(admin), { name: 'Salon' })).json());
});
afterAll(async () => {
  await h.close();
});

const as = (who: SignedIn) => who.tokens.accessToken;
const prefsIn = async (who: SignedIn) =>
  RoomList.parse((await h.request('GET', '/rooms', as(who))).json()).rooms.find(
    (r) => r.id === room.id,
  )?.prefs;

describe('notification settings per room (A28)', () => {
  it('start at the defaults, change per member, and reach their other devices', async () => {
    const ayse = await h.signUp();
    expect(await prefsIn(ayse)).toEqual(DEFAULT_ROOM_PREFS);

    const otherDevice = await h.connect(as(ayse));
    await otherDevice.waitFor('welcome');
    const muted = { notify: 'muted', sound: false, hangoutAlerts: false, favorite: true } as const;
    const res = await h.request('PUT', `/rooms/${room.id}/prefs`, as(ayse), muted);
    expect(res.statusCode, res.body).toBe(200);

    await otherDevice.waitFor(
      'room_prefs',
      (m) => m.roomId === room.id && m.prefs.notify === 'muted',
    );
    expect(await prefsIn(ayse)).toEqual(muted);
    // Only hers: the admin's stay as they were.
    expect(await prefsIn(admin)).toEqual(DEFAULT_ROOM_PREFS);
    otherDevice.ws.terminate();
  });

  it('keeps the read marker and the settings apart', async () => {
    const kerem = await h.signUp();
    await h.request('PUT', `/rooms/${room.id}/prefs`, as(kerem), {
      notify: 'all',
      sound: true,
      hangoutAlerts: true,
    });
    const sent = await h.request('POST', `/rooms/${room.id}/messages`, as(admin), {
      id: '0192f0c4-7b5e-7c8e-9a3b-00000000f001',
      body: 'Merhaba',
    });
    await h.request('POST', `/rooms/${room.id}/read`, as(kerem), {
      messageId: Message.parse(sent.json()).id,
    });
    expect(await prefsIn(kerem)).toEqual({
      notify: 'all',
      sound: true,
      hangoutAlerts: true,
      favorite: false,
    });
  });

  it('accepts prefs without `favorite` from older apps, as not a favourite', async () => {
    const zeynep = await h.signUp();
    const res = await h.request('PUT', `/rooms/${room.id}/prefs`, as(zeynep), {
      notify: 'muted',
      sound: false,
      hangoutAlerts: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await prefsIn(zeynep)).toEqual({ ...DEFAULT_ROOM_PREFS, notify: 'muted' });
  });
});
