// A running app on a fresh database, with helpers to sign members up and open gateway
// connections that record what the server sends. Shared by the integration tests.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  ServerMessage,
  SignedIn,
  parseFrame,
  type ClientMessage,
  type Role,
} from '@hasbihal/protocol';
import { buildApp } from '../src/app.ts';
import { createInvite } from '../src/auth/routes.ts';
import { loadConfig } from '../src/config.ts';
import { LocalFileStore } from '../src/files/store.ts';
import { GatewayHub } from '../src/gateway/hub.ts';
import { createTestDatabase, type TestDatabase } from './database.ts';

export const PASSWORD = 'bir uzun parola cümlesi';

/** A gateway connection that records every server message. */
export interface TestClient {
  ws: WebSocket;
  messages: ServerMessage[];
  send(message: ClientMessage): void;
  /** Resolves with the first recorded message (from index `from` on) that matches. */
  waitFor<T extends ServerMessage['type']>(
    type: T,
    match?: (m: Extract<ServerMessage, { type: T }>) => boolean,
    from?: number,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  closed: Promise<number>;
}

export interface Harness {
  app: FastifyInstance;
  hub: GatewayHub;
  testDb: TestDatabase;
  /** Where this harness's uploads go (a temporary folder). */
  filesDir: string;
  signUp(role?: Role): Promise<SignedIn>;
  connect(accessToken: string, lastSeq?: number): Promise<TestClient>;
  /** An authenticated request; `payload` makes it JSON. */
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    token: string,
    payload?: object,
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

let counter = 0;

export async function startHarness(): Promise<Harness> {
  const testDb = await createTestDatabase();
  const hub = new GatewayHub(testDb.db);
  const filesDir = await mkdtemp(path.join(tmpdir(), 'hasbihal-files-'));
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent', AUTH_RATE_LIMIT_PER_MINUTE: '10000' }),
    { db: testDb.db, hub, files: new LocalFileStore(filesDir) },
  );
  await app.ready();

  return {
    app,
    hub,
    testDb,
    filesDir,
    async signUp(role: Role = 'member') {
      const invite = await createInvite(testDb.db, role, null);
      const n = String(++counter);
      const res = await app.inject({
        method: 'POST',
        url: '/auth/sign-up',
        payload: {
          inviteToken: invite.token,
          username: `user_${n}`,
          displayName: `Üye ${n}`,
          password: PASSWORD,
          deviceName: 'Test',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      await hub.settled(); // its member_joined event has gone out
      return SignedIn.parse(res.json());
    },
    async connect(accessToken, lastSeq) {
      const ws = await app.injectWS('/ws');
      const messages: ServerMessage[] = [];
      ws.on('message', (data: Buffer) => {
        const message = parseFrame(ServerMessage, data.toString());
        if (message) messages.push(message);
      });
      const closed = new Promise<number>((resolve) => ws.once('close', resolve));
      const client: TestClient = {
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
    },
    async request(method, url, token, payload) {
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      });
      await hub.settled(); // any events it wrote have gone out
      return res;
    },
    async close() {
      await app.close();
      await testDb.drop();
      await rm(filesDir, { recursive: true, force: true });
    },
  };
}
