import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type HealthResponse } from '@hasbihal/protocol';
import type { Config } from './config.ts';
import { isDatabaseReachable, type Db } from './db/database.ts';
import { registerErrorHandling } from './errors.ts';
import { registerGateway } from './gateway.ts';

/** What the app needs from outside. The caller owns these and closes them. */
export interface AppDeps {
  db: Db;
}

export async function buildApp(config: Config, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // The WebSocket gateway enforces its own message size; keep HTTP bodies small until uploads (M4).
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandling(app);
  await app.register(cors, { origin: config.allowedOrigins });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const ok = await isDatabaseReachable(deps.db);
    if (!ok) void reply.code(503);
    return {
      status: ok ? 'ok' : 'unavailable',
      serverVersion: config.serverVersion,
      protocolVersion: PROTOCOL_VERSION,
    };
  });

  registerGateway(app, config);

  return app;
}
