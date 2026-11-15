import { z } from 'zod';

/**
 * WebSocket gateway messages (ARCHITECTURE §5).
 * Every frame is a JSON object discriminated by `type`.
 */

// ---- client → server -------------------------------------------------------

export const ClientHello = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int(),
  clientVersion: z.string().min(1).max(64),
  /** Last durable event sequence the client applied; omitted on first connect. */
  lastSeq: z.number().int().nonnegative().optional(),
});
export type ClientHello = z.infer<typeof ClientHello>;

export const ClientPing = z.object({
  type: z.literal('ping'),
});
export type ClientPing = z.infer<typeof ClientPing>;

export const ClientMessage = z.discriminatedUnion('type', [ClientHello, ClientPing]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- server → client -------------------------------------------------------

export const ServerWelcome = z.object({
  type: z.literal('welcome'),
  serverVersion: z.string(),
  protocolVersion: z.number().int(),
});
export type ServerWelcome = z.infer<typeof ServerWelcome>;

export const ServerUpgradeRequired = z.object({
  type: z.literal('upgrade_required'),
  minProtocolVersion: z.number().int(),
  maxProtocolVersion: z.number().int(),
});
export type ServerUpgradeRequired = z.infer<typeof ServerUpgradeRequired>;

export const ServerPong = z.object({
  type: z.literal('pong'),
});
export type ServerPong = z.infer<typeof ServerPong>;

export const ServerError = z.object({
  type: z.literal('error'),
  code: z.enum(['bad_message', 'hello_required']),
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerError>;

export const ServerMessage = z.discriminatedUnion('type', [
  ServerWelcome,
  ServerUpgradeRequired,
  ServerPong,
  ServerError,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** WebSocket close codes used by the gateway (4000–4999 are application-defined). */
export const GatewayCloseCode = {
  upgradeRequired: 4001,
  protocolViolation: 4002,
} as const;

/** Parses one raw WebSocket frame; returns undefined when it isn't a valid message. */
export function parseFrame<T>(schema: z.ZodType<T>, raw: string): T | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}
