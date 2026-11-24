// A running app on a fresh database, with helpers to sign members up and open gateway
// connections that record what the server sends. Shared by the integration tests.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import type { WebSocket } from 'ws';
import {
  GoogleSignInResult,
  PROTOCOL_VERSION,
  ServerMessage,
  parseFrame,
  type ClientMessage,
  type Role,
  type SignedIn,
} from '@hasbihal/protocol';
import { buildApp, type AppDeps } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { LocalFileStore } from '../src/files/store.ts';
import { GatewayHub } from '../src/gateway/hub.ts';
import { createTestDatabase, type TestDatabase } from './database.ts';
import { fakeGoogle, type FakeGoogle, type GoogleAccount } from './google.ts';

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
  /** Google, as the app sees it in tests: makes accounts and their ID tokens. */
  google: FakeGoogle;
  /** A new member: their address is put on the list, then they sign in with Google. */
  signUp(role?: Role): Promise<SignedIn & { account: GoogleAccount }>;
  /** `POST /auth/google` with this account's ID token. */
  signInWithGoogle(account: GoogleAccount, deviceName?: string): Promise<LightMyRequestResponse>;
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

/**
 * `deps` overrides parts of the app, e.g. a fetcher that may reach a local test site; `env` its
 * configuration.
 */
export async function startHarness(
  deps: Partial<AppDeps> = {},
  env: Record<string, string> = {},
): Promise<Harness> {
  const testDb = await createTestDatabase();
  const hub = new GatewayHub(testDb.db);
  const filesDir = await mkdtemp(path.join(tmpdir(), 'hasbihal-files-'));
  const google = await fakeGoogle();
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent', AUTH_RATE_LIMIT_PER_MINUTE: '10000', ...env }),
    // No real LiveKit in tests: its room listing is empty.
    {
      db: testDb.db,
      hub,
      files: new LocalFileStore(filesDir),
      livekitRooms: { list: () => Promise.resolve(new Map()), remove: () => Promise.resolve() },
      // Tests run jobs when they choose (app.jobs.runDue()), so nothing races them.
      runJobs: false,
      google: google.verifier,
      ...deps,
    },
  );
  await app.ready();

  const signInWithGoogle = async (account: GoogleAccount, deviceName = 'Test') => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: await google.idToken(account), deviceName },
    });
    await hub.settled(); // a new member's member_joined event has gone out
    return res;
  };

  return {
    app,
    hub,
    testDb,
    filesDir,
    google,
    signInWithGoogle,
    async signUp(role: Role = 'member') {
      const account = google.account();
      await testDb.db
        .insertInto('allowed_emails')
        .values({ email: account.email, role, added_by: null })
        .execute();
      const res = await signInWithGoogle(account);
      expect(res.statusCode, res.body).toBe(200);
      const result = GoogleSignInResult.parse(res.json());
      if (result.status !== 'signed_in') throw new Error(`not signed in: ${res.body}`);
      return { user: result.user, tokens: result.tokens, account };
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
