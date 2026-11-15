import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import {
  GatewayCloseCode,
  MemberList,
  PROTOCOL_VERSION,
  ServerMessage,
  SignedIn,
  parseFrame,
  type ClientMessage,
} from '@hasbihal/protocol';
import { buildApp } from '../app.ts';
import { createInvite } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { GatewayHub } from './hub.ts';

let app: FastifyInstance;
let hub: GatewayHub;
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  hub = new GatewayHub(testDb.db);
  app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', AUTH_RATE_LIMIT_PER_MINUTE: '10000' }), {
    db: testDb.db,
    hub,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

let counter = 0;
const PASSWORD = 'bir uzun parola cümlesi';

async function signUp(): Promise<SignedIn> {
  const invite = await createInvite(testDb.db, 'member', null);
  const res = await app.inject({
    method: 'POST',
    url: '/auth/sign-up',
    payload: {
      inviteToken: invite.token,
      username: `gw_${String(++counter)}`,
      displayName: `Üye ${String(counter)}`,
      password: PASSWORD,
      deviceName: 'Test',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  await hub.settled(); // the member_joined event has gone out
  return SignedIn.parse(res.json());
}

/** A gateway connection that records every server message. */
interface Client {
  ws: WebSocket;
  messages: ServerMessage[];
  send(message: ClientMessage): void;
  /** Resolves with the first recorded message (from `from` on) that matches. */
  waitFor<T extends ServerMessage['type']>(
    type: T,
    match?: (m: Extract<ServerMessage, { type: T }>) => boolean,
    from?: number,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  closed: Promise<number>;
}

async function connect(accessToken: string, lastSeq?: number): Promise<Client> {
  const ws = await app.injectWS('/ws');
  const messages: ServerMessage[] = [];
  ws.on('message', (data: Buffer) => {
    const message = parseFrame(ServerMessage, data.toString());
    if (message) messages.push(message);
  });
  const closed = new Promise<number>((resolve) => ws.once('close', resolve));
  const client: Client = {
    ws,
    messages,
    closed,
    send: (message) => {
      ws.send(JSON.stringify(message));
    },
    waitFor: async (type, match = () => true, from = 0) => {
      for (let i = 0; i < 200; i++) {
        const found = messages.slice(from).find((m) => m.type === type && match(m as never));
        if (found) return found as never;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${type} message; got ${JSON.stringify(messages)}`);
    },
  };
  client.send({
    type: 'hello',
    protocolVersion: PROTOCOL_VERSION,
    clientVersion: '0.1.0',
    accessToken,
    ...(lastSeq === undefined ? {} : { lastSeq }),
  });
  return client;
}

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
    const event = await client.waitFor('event', (m) => m.event.user.id === joined.user.id);
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
    await again.waitFor('event', (m) => m.event.user.id === missedB.user.id);
    const replayed = again.messages.filter((m) => m.type === 'event');
    expect(replayed.map((m) => m.event.user.id)).toEqual([missedA.user.id, missedB.user.id]);
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
    const { head } = await import('./events.ts').then((m) => m.logBounds(testDb.db));
    await testDb.db.deleteFrom('event_log').where('seq', '<', String(head)).execute();
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
    await app.inject({
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
        await app.inject({
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
    await app.inject({
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
    const res = await app.inject({
      method: 'GET',
      url: '/members',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(MemberList.parse(res.json()).members.map((m) => m.id)).toContain(user.id);
    expect((await app.inject({ method: 'GET', url: '/members' })).statusCode).toBe(401);
  });
});
