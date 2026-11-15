import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  GatewayCloseCode,
  HealthResponse,
  PROTOCOL_VERSION,
  ServerMessage,
  parseFrame,
} from '@hasbihal/protocol';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', HELLO_TIMEOUT_MS: '200' }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/** Resolves with the next server message and, if the server closes, the close code. */
function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data: Buffer) => {
      const message = parseFrame(ServerMessage, data.toString());
      if (message) resolve(message);
      else reject(new Error(`unparseable frame: ${data.toString()}`));
    });
  });
}

function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code: number) => {
      resolve(code);
    });
  });
}

describe('GET /health', () => {
  it('reports status and versions', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('allows the desktop dev origin and rejects others', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const other = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('WebSocket gateway', () => {
  it('welcomes a supported client', async () => {
    const ws = await app.injectWS('/ws');
    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientVersion: '0.1.0' }),
    );
    expect(await reply).toMatchObject({ type: 'welcome', protocolVersion: PROTOCOL_VERSION });

    const pong = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    expect(await pong).toEqual({ type: 'pong' });
    ws.terminate();
  });

  it('asks an unsupported client to upgrade and closes', async () => {
    const ws = await app.injectWS('/ws');
    const reply = nextMessage(ws);
    const closed = closeCode(ws);
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 0, clientVersion: '0.0.1' }));
    expect((await reply).type).toBe('upgrade_required');
    expect(await closed).toBe(GatewayCloseCode.upgradeRequired);
  });

  it('rejects messages before hello', async () => {
    const ws = await app.injectWS('/ws');
    const reply = nextMessage(ws);
    const closed = closeCode(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    expect(await reply).toMatchObject({ type: 'error', code: 'hello_required' });
    expect(await closed).toBe(GatewayCloseCode.protocolViolation);
  });

  it('rejects malformed frames', async () => {
    const ws = await app.injectWS('/ws');
    const reply = nextMessage(ws);
    const closed = closeCode(ws);
    ws.send('{oops');
    expect(await reply).toMatchObject({ type: 'error', code: 'bad_message' });
    expect(await closed).toBe(GatewayCloseCode.protocolViolation);
  });

  it('closes clients that never say hello', async () => {
    const ws = await app.injectWS('/ws');
    const reply = nextMessage(ws);
    const closed = closeCode(ws);
    expect(await reply).toMatchObject({ type: 'error', code: 'hello_required' });
    expect(await closed).toBe(GatewayCloseCode.protocolViolation);
  });
});
