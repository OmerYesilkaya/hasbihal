// Starts what the app talks to: PostgreSQL in Docker and the real server as a child process, on
// free ports. Their addresses reach the tests through process.env. PostgreSQL is started with the
// docker CLI rather than Testcontainers, which trips a module-loading bug in Node 24.2 when loaded
// through Playwright.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { E2E_FEEDBACK_REPO, E2E_GITHUB_TOKEN, startFakeGithub } from './fake-github.ts';
import { E2E_GOOGLE_CLIENT_ID, startFakeGoogle } from './fake-google.ts';
import { allowEmailOnServer, googleAccount, SERVER_DIR, signInWithGoogle } from './support.ts';

const run = promisify(execFile);
const POSTGRES_IMAGE = 'postgres:17.12'; // same as infra/compose.dev.yml
const LIVEKIT_IMAGE = 'livekit/livekit-server:v1.13.11';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

async function waitForHealth(url: string, server: ChildProcess): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`server exited with ${String(server.exitCode)}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become healthy');
}

/** A throwaway PostgreSQL container; resolves with its URL and a function that removes it. */
async function startPostgres(): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const { stdout } = await run('docker', [
    'run',
    '--detach',
    '--rm',
    '--publish',
    `127.0.0.1:${String(port)}:5432`,
    '--env',
    'POSTGRES_USER=hasbihal',
    '--env',
    'POSTGRES_PASSWORD=e2e',
    '--env',
    'POSTGRES_DB=hasbihal',
    POSTGRES_IMAGE,
  ]);
  const id = stdout.trim();
  const stop = async () => {
    await run('docker', ['rm', '--force', id]).catch(() => undefined);
  };
  for (let i = 0; i < 150; i++) {
    // pg_isready over TCP: the image's first, socket-only start doesn't count.
    const ready = await run('docker', [
      'exec',
      id,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'hasbihal',
      '-d',
      'hasbihal',
    ]).then(
      () => true,
      () => false,
    );
    if (ready) return { url: `postgres://hasbihal:e2e@127.0.0.1:${String(port)}/hasbihal`, stop };
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error('PostgreSQL did not start');
}

/**
 * A LiveKit of its own (not the dev one), with webhooks to this test server. Fixed ports beside
 * the dev LiveKit's 7880–7882, so both can run.
 */
const LIVEKIT_PORTS = { http: 7980, tcp: 7981, udp: 7982 };

/**
 * How LiveKit's container reaches the test server, which listens on 127.0.0.1. Linux: host
 * networking, as in production, so loopback is the host's. Docker Desktop (macOS) has its own
 * name for the host's loopback instead, and needs the ports published.
 */
const HOST_NETWORK = process.platform === 'linux';
const HOST_FROM_LIVEKIT = HOST_NETWORK ? '127.0.0.1' : 'host.docker.internal';
const LIVEKIT_NETWORK = HOST_NETWORK
  ? ['--network', 'host']
  : [
      '--add-host',
      'host.docker.internal:host-gateway',
      '--publish',
      `127.0.0.1:${String(LIVEKIT_PORTS.http)}:${String(LIVEKIT_PORTS.http)}`,
      '--publish',
      `127.0.0.1:${String(LIVEKIT_PORTS.tcp)}:${String(LIVEKIT_PORTS.tcp)}`,
      '--publish',
      `127.0.0.1:${String(LIVEKIT_PORTS.udp)}:${String(LIVEKIT_PORTS.udp)}/udp`,
    ];

async function startLiveKit(
  serverPort: number,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hasbihal-e2e-livekit-'));
  const config = path.join(dir, 'livekit.yaml');
  const dev = await readFile(
    path.resolve(import.meta.dirname, '../../../infra/livekit.dev.yaml'),
    'utf8',
  );
  // The dev codec list (T8), with this run's ports and webhook target.
  const devConfig = dev.replace(/webhook:[\s\S]*$/, '');
  await writeFile(
    config,
    `${devConfig}port: ${String(LIVEKIT_PORTS.http)}
rtc:
  tcp_port: ${String(LIVEKIT_PORTS.tcp)}
  udp_port: ${String(LIVEKIT_PORTS.udp)}
# Chrome's fake microphone beeps briefly once a second; the default (sound in 40% of frames)
# never counts that as speaking.
audio:
  min_percentile: 5
webhook:
  api_key: devkey
  urls:
    - http://${HOST_FROM_LIVEKIT}:${String(serverPort)}/hooks/livekit
`,
  );
  const { stdout } = await run('docker', [
    'run',
    '--detach',
    '--rm',
    ...LIVEKIT_NETWORK,
    '--volume',
    `${config}:/etc/livekit.yaml:ro`,
    LIVEKIT_IMAGE,
    '--dev',
    '--config',
    '/etc/livekit.yaml',
    '--bind',
    '0.0.0.0',
    '--node-ip',
    '127.0.0.1',
  ]);
  const id = stdout.trim();
  const url = `http://127.0.0.1:${String(LIVEKIT_PORTS.http)}`;
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    ) {
      return {
        url: `ws://127.0.0.1:${String(LIVEKIT_PORTS.http)}`,
        stop: async () => {
          await run('docker', ['rm', '--force', id]).catch(() => undefined);
        },
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await run('docker', ['rm', '--force', id]).catch(() => undefined);
  throw new Error('LiveKit did not start');
}

/** A stand-in website for link previews: one page with Open Graph tags and a picture. */
async function startSite(): Promise<{ url: string; stop: () => Promise<void> }> {
  const picture = await readFile(path.resolve(import.meta.dirname, 'fixtures/manzara.jpg'));
  const site = createHttpServer((request, response) => {
    if (request.url === '/tarif') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<head><title>Kuru fasulye</title>
        <meta property="og:title" content="Kuru fasulye ve pilav">
        <meta property="og:description" content="Annemin tarifi, adım adım: bir gece önceden ıslatılmış fasulye, kuru soğan, salça.">
        <meta property="og:site_name" content="Lezzet Defteri">
        <meta property="og:image" content="/kapak.jpg"></head>`);
    } else if (request.url === '/kapak.jpg') {
      response.writeHead(200, { 'content-type': 'image/jpeg' });
      response.end(picture);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    stop: () =>
      new Promise((resolve) => {
        site.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * The admin the tests act through to set the scene (the list, rooms), made the way the owner
 * makes the first one (A25, A52): the server command, then a Google sign-in.
 */
const SEED_EMAIL = 'kurucu.e2e@gmail.com';
async function createSeedAdmin(serverUrl: string, databaseUrl: string, googleUrl: string) {
  await googleAccount({ email: SEED_EMAIL, name: 'Kurucu' }, googleUrl);
  await allowEmailOnServer(SEED_EMAIL, 'admin', databaseUrl);
  const result = await signInWithGoogle(SEED_EMAIL, serverUrl, googleUrl);
  if (result.status !== 'signed_in' || result.user.role !== 'admin')
    throw new Error(`seed admin: ${JSON.stringify(result)}`);
  return SEED_EMAIL;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const database = await startPostgres();
  const site = await startSite();
  const google = await startFakeGoogle();
  const github = await startFakeGithub();
  const port = await freePort();
  const serverUrl = `http://127.0.0.1:${String(port)}`;
  const livekit = await startLiveKit(port);
  const env = {
    ...process.env,
    DATABASE_URL: database.url,
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    NODE_ENV: 'test',
    LIVEKIT_URL: livekit.url,
    LIVEKIT_API_URL: livekit.url.replace('ws:', 'http:'),
    // Link previews may reach the local stand-in site above.
    LINK_PREVIEW_ALLOW_PRIVATE: 'true',
    // Every test signs people in through the API: far more than a person would.
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    // Google is the stand-in (fake-google.ts).
    GOOGLE_CLIENT_ID: E2E_GOOGLE_CLIENT_ID,
    GOOGLE_ISSUER: google.url,
    GOOGLE_JWKS_URL: `${google.url}/certs`,
    // Feedback issues go to the stand-in GitHub (fake-github.ts).
    FEEDBACK_GITHUB_REPO: E2E_FEEDBACK_REPO,
    FEEDBACK_GITHUB_TOKEN: E2E_GITHUB_TOKEN,
    FEEDBACK_GITHUB_API_URL: github.url,
  };
  const server = spawn(process.execPath, ['src/main.ts'], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForHealth(serverUrl, server);

  process.env.E2E_SERVER_URL = serverUrl;
  process.env.E2E_LIVEKIT_URL = livekit.url;
  process.env.E2E_DATABASE_URL = database.url;
  process.env.E2E_SITE_URL = site.url;
  process.env.E2E_GOOGLE_URL = google.url;
  process.env.E2E_GITHUB_URL = github.url;
  process.env.E2E_SEED_EMAIL = await createSeedAdmin(serverUrl, database.url, google.url);

  return async () => {
    server.kill('SIGTERM');
    await Promise.all([database.stop(), livekit.stop(), site.stop(), google.stop(), github.stop()]);
  };
}
