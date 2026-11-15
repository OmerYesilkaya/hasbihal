import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type HealthResponse } from '@hasbihal/protocol';
import type { Config } from './config.ts';
import { registerGateway } from './gateway.ts';

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // The WebSocket gateway enforces its own message size; keep HTTP bodies small until uploads (M4).
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, { origin: config.allowedOrigins });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/health', (): HealthResponse => ({
    status: 'ok',
    serverVersion: config.serverVersion,
    protocolVersion: PROTOCOL_VERSION,
  }));

  registerGateway(app, config);

  return app;
}
