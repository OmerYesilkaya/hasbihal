import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type HealthResponse } from '@hasbihal/protocol';
import { registerAuth } from './auth/routes.ts';
import { generateSigningKeyPem, signingKeysFromPem, type SigningKeys } from './auth/tokens.ts';
import type { Config } from './config.ts';
import { isDatabaseReachable, type Db } from './db/database.ts';
import { registerErrorHandling } from './errors.ts';
import { GatewayHub } from './gateway/hub.ts';
import { registerGateway } from './gateway/routes.ts';
import { registerMembers } from './members/routes.ts';
import { registerChat } from './chat/routes.ts';

/** What the app needs from outside. The caller owns these and closes them. */
export interface AppDeps {
  db: Db;
  /** Pass one to observe it (tests); otherwise the app makes its own. */
  hub?: GatewayHub;
}

/**
 * The access-token signing keys. Without a configured key, development makes a throwaway one:
 * restarting the server then expires access tokens early, which refresh tokens absorb.
 */
function signingKeys(config: Config, app: FastifyInstance): SigningKeys {
  if (config.signingKeyPem) return signingKeysFromPem(config.signingKeyPem);
  if (config.production) throw new Error('AUTH_SIGNING_KEY is required in production');
  app.log.warn('AUTH_SIGNING_KEY is not set; using a temporary key (development only)');
  return signingKeysFromPem(generateSigningKeyPem());
}

export async function buildApp(config: Config, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    // The WebSocket gateway enforces its own message size; keep HTTP bodies small until uploads (M4).
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandling(app);
  await app.register(cors, {
    origin: config.allowedOrigins,
    // @fastify/cors allows only GET, HEAD, and POST by default; editing, deleting, and reacting
    // from the app need the rest (browsers preflight them).
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
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

  const keys = signingKeys(config, app);
  const hub = deps.hub ?? new GatewayHub(deps.db);
  await hub.start();
  app.addHook('onClose', () => {
    hub.stop();
  });

  const guards = await registerAuth(app, {
    db: deps.db,
    keys,
    rateLimitPerMinute: config.authRateLimitPerMinute,
    gateway: hub,
  });
  registerMembers(app, deps.db, guards);
  registerChat(app, { db: deps.db, hub, guards });
  registerGateway(app, config, { db: deps.db, keys, hub });

  return app;
}
