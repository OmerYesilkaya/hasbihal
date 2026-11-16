import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hasbihal/core';
import { Message, Room, SearchResults, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
let salon: Room;
let mutfak: Room;
const sent: Record<string, Message> = {};

const as = (who: SignedIn) => who.tokens.accessToken;

async function send(room: Room, body: string): Promise<Message> {
  const res = await h.request('POST', `/rooms/${room.id}/messages`, as(admin), {
    id: newId(),
    body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return Message.parse(res.json());
}

const search = async (q: string, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ q, ...extra });
  const res = await h.request('GET', `/search?${params.toString()}`, as(admin));
  expect(res.statusCode, res.body).toBe(200);
  return SearchResults.parse(res.json());
};
const bodies = (results: SearchResults) => results.messages.map((m) => m.body);

beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
  salon = Room.parse((await h.request('POST', '/rooms', as(admin), { name: 'Salon' })).json());
  mutfak = Room.parse((await h.request('POST', '/rooms', as(admin), { name: 'Mutfak' })).json());
  sent.aksam = await send(salon, 'Akşam **çay** içelim mi?');
  sent.isik = await send(salon, "IŞIK'ı kapatır mısın");
  sent.silinen = await send(salon, 'Bu çay mesajı silinecek');
  await h.request('DELETE', `/messages/${sent.silinen.id}`, as(admin));
  sent.kahve = await send(salon, 'Kahve de olur');
  sent.caylar = await send(mutfak, 'Çaylar demlendi');
});
afterAll(async () => {
  await h.close();
});

describe('search (A27)', () => {
  it('folds Turkish letters both ways, matches word beginnings, newest first', async () => {
    expect(bodies(await search('cay'))).toEqual(['Çaylar demlendi', 'Akşam **çay** içelim mi?']);
    expect(bodies(await search('ÇAY'))).toEqual(bodies(await search('cay')));
    expect(bodies(await search('isik'))).toEqual(["IŞIK'ı kapatır mısın"]);
    expect(bodies(await search('ışık'))).toEqual(["IŞIK'ı kapatır mısın"]);
    expect(bodies(await search('İçelim'))).toEqual(['Akşam **çay** içelim mi?']);
  });

  it('needs every word, and leaves out deleted messages', async () => {
    expect(bodies(await search('akşam çay'))).toEqual(['Akşam **çay** içelim mi?']);
    expect(bodies(await search('akşam kahve'))).toEqual([]);
    expect(bodies(await search('silinecek'))).toEqual([]);
  });

  it('narrows to a room, and pages back', async () => {
    expect(bodies(await search('cay', { roomId: salon.id }))).toEqual(['Akşam **çay** içelim mi?']);
    const first = await search('cay', { limit: '1' });
    expect(first.hasMore).toBe(true);
    const next = await search('cay', { limit: '1', before: first.messages[0]?.id ?? '' });
    expect(bodies(next)).toEqual(['Akşam **çay** içelim mi?']);
    expect(next.hasMore).toBe(false);
  });

  it('treats punctuation as nothing to search for', async () => {
    expect(bodies(await search('!!! :* &'))).toEqual([]);
  });
});
