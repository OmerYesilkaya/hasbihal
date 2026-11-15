import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GatewayCloseCode, MemberList, SignedIn } from '@hasbihal/protocol';
import { PASSWORD, startHarness, type Harness } from '../../test/harness.ts';
import { logBounds } from './events.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const signUp = () => h.signUp();
const connect = (accessToken: string, lastSeq?: number) => h.connect(accessToken, lastSeq);

describe('welcome', () => {
  it('welcomes with me, the current seq, and who is online', async () => {
    const { user, tokens } = await signUp();
    const client = await connect(tokens.accessToken);
    const welcome = await client.waitFor('welcome');
    expect(welcome.me.id).toBe(user.id);
    expect(welcome.resync).toBe(false);
    expect(welcome.seq).toBeGreaterThan(0); // at least this member's own member_joined
    expect(welcome.presence[user.id]).toBe('available');
    expect(client.messages[0]?.type).toBe('welcome'); // nothing before the welcome
    client.ws.terminate();
  });
});

describe('durable events', () => {
  it('delivers events live, in order', async () => {
    const watcher = await signUp();
    const client = await connect(watcher.tokens.accessToken);
    const { seq } = await client.waitFor('welcome');
    const joined = await signUp();
    const event = await client.waitFor(
      'event',
      (m) => m.event.type === 'member_joined' && m.event.user.id === joined.user.id,
    );
    expect(event.seq).toBeGreaterThan(seq);
    client.ws.terminate();
  });

  it('replays what was missed while disconnected', async () => {
    const watcher = await signUp();
    const first = await connect(watcher.tokens.accessToken);
    const { seq } = await first.waitFor('welcome');
    first.ws.terminate();

    const missedA = await signUp();
    const missedB = await signUp();

    const again = await connect(watcher.tokens.accessToken, seq);
    expect((await again.waitFor('welcome')).resync).toBe(false);
    await again.waitFor(
      'event',
      (m) => m.event.type === 'member_joined' && m.event.user.id === missedB.user.id,
    );
    const replayed = again.messages.filter((m) => m.type === 'event');
    expect(
      replayed.map((m) => (m.event.type === 'member_joined' ? m.event.user.id : null)),
    ).toEqual([missedA.user.id, missedB.user.id]);
    again.ws.terminate();
  });

  it('asks a client to resync when its position is unknown to the server', async () => {
    const { tokens } = await signUp();
    const client = await connect(tokens.accessToken, 1_000_000);
    const welcome = await client.waitFor('welcome');
    expect(welcome.resync).toBe(true);
    client.ws.terminate();
  });

  it('asks a client to resync when the log no longer reaches back to it', async () => {
    const { tokens } = await signUp();
    // Simulate pruning: drop the oldest events.
    const { head } = await logBounds(h.testDb.db);
    await h.testDb.db.deleteFrom('event_log').where('seq', '<', String(head)).execute();
    const client = await connect(tokens.accessToken, 0);
    expect((await client.waitFor('welcome')).resync).toBe(head > 1);
    client.ws.terminate();
  });

  it('keeps seq order without gaps when sign-ups commit concurrently', async () => {
    const watcher = await signUp();
    const client = await connect(watcher.tokens.accessToken);
    const { seq } = await client.waitFor('welcome');
    const joined = await Promise.all(Array.from({ length: 8 }, () => signUp()));
    await client.waitFor('event', (m) => m.seq === seq + joined.length);
    const seqs = client.messages.filter((m) => m.type === 'event').map((m) => m.seq);
    expect(seqs).toEqual(Array.from({ length: joined.length }, (_, i) => seq + i + 1));
    client.ws.terminate();
  });
});

describe('presence (A21)', () => {
  it('announces online, busy, away, and offline', async () => {
    const watcher = await signUp();
    const other = await signUp();
    const client = await connect(watcher.tokens.accessToken);
    await client.waitFor('welcome');
    const status = (s: string, from: number) =>
      client.waitFor('presence', (m) => m.userId === other.user.id && m.status === s, from);

    let mark = client.messages.length;
    const peer = await connect(other.tokens.accessToken);
    await peer.waitFor('welcome');
    await status('available', mark);

    mark = client.messages.length;
    peer.send({ type: 'set_presence', mode: 'busy' });
    await status('busy', mark);

    mark = client.messages.length;
    peer.send({ type: 'set_presence', mode: 'available' });
    peer.send({ type: 'activity', idle: true });
    await status('away', mark);

    mark = client.messages.length;
    peer.ws.terminate();
    await status('offline', mark);
    client.ws.terminate();
  });

  it('remembers busy across sessions', async () => {
    const member = await signUp();
    const first = await connect(member.tokens.accessToken);
    await first.waitFor('welcome');
    first.send({ type: 'set_presence', mode: 'busy' });
    await first.waitFor('presence', (m) => m.status === 'busy');
    first.ws.terminate();
    await new Promise((r) => setTimeout(r, 50)); // the mode is saved in the background

    const second = await connect(member.tokens.accessToken);
    expect((await second.waitFor('welcome')).presence[member.user.id]).toBe('busy');
    second.ws.terminate();
  });
});

describe('ending sessions', () => {
  it('closes the connection when the session signs out', async () => {
    const { tokens } = await signUp();
    const client = await connect(tokens.accessToken);
    await client.waitFor('welcome');
    await h.app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(await client.closed).toBe(GatewayCloseCode.unauthorized);
  });

  it('closes connections of a revoked device, and only those', async () => {
    const member = await signUp();
    const other = SignedIn.parse(
      (
        await h.app.inject({
          method: 'POST',
          url: '/auth/sign-in',
          payload: { username: member.user.username, password: PASSWORD, deviceName: 'PC' },
        })
      ).json(),
    );
    const mac = await connect(member.tokens.accessToken);
    const pc = await connect(other.tokens.accessToken);
    await mac.waitFor('welcome');
    await pc.waitFor('welcome');
    await h.app.inject({
      method: 'DELETE',
      url: `/me/sessions/${other.tokens.sessionId}`,
      headers: { authorization: `Bearer ${member.tokens.accessToken}` },
    });
    expect(await pc.closed).toBe(GatewayCloseCode.unauthorized);
    expect(mac.ws.readyState).toBe(mac.ws.OPEN);
    mac.ws.terminate();
  });
});

describe('GET /members', () => {
  it('lists members for signed-in users', async () => {
    const { user, tokens } = await signUp();
    const res = await h.app.inject({
      method: 'GET',
      url: '/members',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(MemberList.parse(res.json()).members.map((m) => m.id)).toContain(user.id);
    expect((await h.app.inject({ method: 'GET', url: '/members' })).statusCode).toBe(401);
  });
});
