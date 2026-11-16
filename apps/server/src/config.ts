import path from 'node:path';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };

const Env = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,app://hasbihal')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  HELLO_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Matches infra/compose.dev.yml. Production sets its own.
  DATABASE_URL: z.string().default('postgres://hasbihal:hasbihal-dev@127.0.0.1:5432/hasbihal'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Ed25519 private key (PKCS#8 PEM) that signs access tokens. Required in production; make one
  // with `pnpm --filter @hasbihal/server generate-signing-key`. `\n` escapes are accepted.
  AUTH_SIGNING_KEY: z
    .string()
    .optional()
    .transform((pem) => pem?.replaceAll('\\n', '\n')),
  // Behind a reverse proxy (production), trust its X-Forwarded-For so rate limits see real client IPs.
  TRUST_PROXY: z.stringbool().default(false),
  // Where uploaded files are stored (A54). Relative paths are resolved from the working directory.
  FILES_DIR: z.string().default('data/files'),
  // LiveKit (T5). The URL clients connect to, and where the server reaches LiveKit's API.
  // The key and secret default to LiveKit's dev mode; production must set its own.
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_URL: z.string().default('http://localhost:7880'),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(1).optional(),
  // Lets link previews reach this machine and private networks: end-to-end tests with a local
  // site only. Refused in production, where it would open the server to SSRF (ARCHITECTURE §7).
  LINK_PREVIEW_ALLOW_PRIVATE: z.stringbool().default(false),
  // Requests per IP per minute on the unauthenticated auth routes (sign-in, sign-up, …).
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
});

export interface Config {
  host: string;
  port: number;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
  allowedOrigins: string[];
  helloTimeoutMs: number;
  databaseUrl: string;
  production: boolean;
  signingKeyPem: string | undefined;
  trustProxy: boolean;
  filesDir: string;
  livekit: { url: string; apiUrl: string; apiKey: string; apiSecret: string };
  authRateLimitPerMinute: number;
  linkPreviewAllowPrivate: boolean;
  serverVersion: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  /** LiveKit's dev-mode credentials are fine locally and never in production. */
  const devOnly = (name: string, value: string) => {
    if (parsed.NODE_ENV === 'production') throw new Error(`${name} is required in production`);
    return value;
  };
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    helloTimeoutMs: parsed.HELLO_TIMEOUT_MS,
    databaseUrl: parsed.DATABASE_URL,
    production: parsed.NODE_ENV === 'production',
    signingKeyPem: parsed.AUTH_SIGNING_KEY,
    trustProxy: parsed.TRUST_PROXY,
    filesDir: path.resolve(parsed.FILES_DIR),
    livekit: {
      url: parsed.LIVEKIT_URL,
      apiUrl: parsed.LIVEKIT_API_URL,
      apiKey: parsed.LIVEKIT_API_KEY ?? devOnly('LIVEKIT_API_KEY', 'devkey'),
      apiSecret: parsed.LIVEKIT_API_SECRET ?? devOnly('LIVEKIT_API_SECRET', 'secret'),
    },
    authRateLimitPerMinute: parsed.AUTH_RATE_LIMIT_PER_MINUTE,
    linkPreviewAllowPrivate: (() => {
      if (parsed.LINK_PREVIEW_ALLOW_PRIVATE && parsed.NODE_ENV === 'production')
        throw new Error('LINK_PREVIEW_ALLOW_PRIVATE is never allowed in production');
      return parsed.LINK_PREVIEW_ALLOW_PRIVATE;
    })(),
    serverVersion: pkg.version,
  };
}
