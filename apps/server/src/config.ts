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
});

export interface Config {
  host: string;
  port: number;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
  allowedOrigins: string[];
  helloTimeoutMs: number;
  serverVersion: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    helloTimeoutMs: parsed.HELLO_TIMEOUT_MS,
    serverVersion: pkg.version,
  };
}
