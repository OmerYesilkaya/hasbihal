import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type HealthResponse } from '@hasbihal/protocol';
import { remoteGoogleVerifier, type GoogleVerifier } from './auth/google.ts';
import { GOOGLE_PHOTO_JOB, googlePhotoJob } from './auth/google-photo.ts';
import { registerAuth } from './auth/routes.ts';
import { generateSigningKeyPem, signingKeysFromPem, type SigningKeys } from './auth/tokens.ts';
import type { Config } from './config.ts';
import { isDatabaseReachable, type Db } from './db/database.ts';
import { registerErrorHandling } from './errors.ts';
import { GatewayHub } from './gateway/hub.ts';
import { registerGateway } from './gateway/routes.ts';
import { registerMembers } from './members/routes.ts';
import { registerAdmin } from './admin/routes.ts';
import { registerChat } from './chat/routes.ts';
import { collectOrphanFiles } from './files/gc.ts';
import { registerFiles } from './files/routes.ts';
import { FileUrlSigner } from './files/signing.ts';
import { registerEvents } from './events/routes.ts';
import { EVENT_REMINDER_JOB, eventReminderJob } from './events/service.ts';
import { JobQueue } from './jobs/queue.ts';
import { SafeFetcher, type Fetcher } from './previews/fetcher.ts';
import { LINK_PREVIEW_JOB, linkPreviewJob } from './previews/service.ts';
import { LocalFileStore, type FileStore } from './files/store.ts';
import { registerProfile } from './profile/routes.ts';
import { liveKitRooms, type LiveKitRooms } from './hangouts/livekit.ts';
import { registerHangouts } from './hangouts/routes.ts';
import { HangoutTracker } from './hangouts/tracker.ts';
import { MahremGate } from './mahrem/gate.ts';
import { registerMahrem } from './mahrem/routes.ts';

/** What the app needs from outside. The caller owns these and closes them. */
export interface AppDeps {
  db: Db;
  /** Pass one to observe it (tests); otherwise the app makes its own. */
  hub?: GatewayHub;
  /** Defaults to the local disk at `config.filesDir`. */
  files?: FileStore;
  /** Defaults to the safe internet fetcher; tests reach a local site. */
  fetcher?: Fetcher;
  /** Defaults to running jobs in the background; tests run them on demand. */
  runJobs?: boolean;
  /** Defaults to LiveKit's API at `config.livekit.apiUrl`. */
  livekitRooms?: LiveKitRooms;
  /** Defaults to checking ID tokens against Google's keys (`config.google`); tests sign their own. */
  google?: GoogleVerifier;
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
  // Uploads set their own size limits per route; this only bounds the rest of a multipart request.
  await app.register(multipart, { limits: { fields: 10, files: 1, fieldSize: 1024 } });

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

  const files = deps.files ?? new LocalFileStore(config.filesDir);
  const fetcher = deps.fetcher ?? new SafeFetcher({ allowPrivate: config.linkPreviewAllowPrivate });
  const jobs = new JobQueue(deps.db, app.log, {
    [LINK_PREVIEW_JOB]: linkPreviewJob({
      db: deps.db,
      store: files,
      fetcher,
      committed: () => {
        hub.eventsCommitted();
      },
    }),
    [EVENT_REMINDER_JOB]: eventReminderJob({ db: deps.db, hub }),
    [GOOGLE_PHOTO_JOB]: googlePhotoJob({ db: deps.db, store: files, hub, fetcher }),
  });
  app.decorate('jobs', jobs);
  if (deps.runJobs !== false) {
    app.addHook('onReady', (done) => {
      jobs.start();
      done();
    });
  }
  app.addHook('onClose', () => jobs.stop());
  const jobsQueued = () => {
    jobs.wake();
  };

  const { clientId, issuers, jwksUrl } = config.google;
  const guards = await registerAuth(app, {
    db: deps.db,
    keys,
    rateLimitPerMinute: config.authRateLimitPerMinute,
    gateway: hub,
    google:
      deps.google ?? (clientId ? remoteGoogleVerifier({ clientId, issuers, jwksUrl }) : undefined),
    jobsQueued,
  });
  if (!deps.google && !clientId)
    app.log.warn('GOOGLE_CLIENT_ID is not set; Google sign-in is off (development only)');
  registerMembers(app, deps.db, guards);
  registerAdmin(app, { db: deps.db, hub, guards });
  registerChat(app, { db: deps.db, hub, guards, jobsQueued });
  registerEvents(app, { db: deps.db, hub, guards, jobsQueued });
  registerFiles(app, {
    db: deps.db,
    store: files,
    signer: new FileUrlSigner(keys.privateKey),
    guards,
  });
  // The run in progress, so closing waits for it rather than pulling the database from under it.
  let collecting: Promise<void> = Promise.resolve();
  const collect = () => {
    collecting = collectOrphanFiles(deps.db, files).then(
      (count) => {
        if (count) app.log.info({ count }, 'removed unused files');
      },
      (error: unknown) => {
        app.log.warn({ err: error }, 'file cleanup failed');
      },
    );
  };
  const cleanup = setInterval(collect, 60 * 60 * 1000);
  cleanup.unref();
  app.addHook('onReady', (done) => {
    collect(); // in the background: startup doesn't wait for it
    done();
  });
  app.addHook('onClose', async () => {
    clearInterval(cleanup);
    await collecting;
  });
  registerProfile(app, { db: deps.db, store: files, hub, guards });
  const tracker = new HangoutTracker({
    changed: (roomId, participants) => {
      hub.broadcast({ type: 'hangout', roomId, participants });
    },
    // A28: everyone hears that a hangout started, except the joiner and anyone busy (A19).
    started: (roomId, userId) => {
      hub.broadcast(
        { type: 'hangout_started', roomId, userId },
        (id) => id === userId || hub.isBusy(id),
      );
    },
  });
  const livekitRooms = deps.livekitRooms ?? liveKitRooms(config.livekit);
  const gate = new MahremGate({ db: deps.db, rooms: livekitRooms, log: app.log });
  await registerHangouts(app, {
    db: deps.db,
    hub,
    tracker,
    livekit: config.livekit,
    rooms: livekitRooms,
    gate,
    guards,
  });
  registerMahrem(app, { db: deps.db, hub, tracker, gate, guards });
  registerGateway(app, config, { db: deps.db, keys, hub, hangouts: () => tracker.snapshot() });

  return app;
}
