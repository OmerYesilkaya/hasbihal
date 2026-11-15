import { z } from 'zod';
import { User } from './auth.ts';
import { Id } from './id.ts';

/**
 * WebSocket gateway messages (ARCHITECTURE §5).
 * Every frame is a JSON object discriminated by `type`.
 */

// ---- presence (A21, ARCHITECTURE §5.4) ------------------------------------------------------

/** What the user chose: shown as Müsait or Meşgul. */
export const PresenceMode = z.enum(['available', 'busy']);
export type PresenceMode = z.infer<typeof PresenceMode>;

/** What others see: the chosen mode, or `away` after 10 idle minutes, or `offline`. */
export const PresenceStatus = z.enum(['available', 'away', 'busy', 'offline']);
export type PresenceStatus = z.infer<typeof PresenceStatus>;

// ---- durable events (ARCHITECTURE §5.2) -----------------------------------------------------

/** A new member signed up through an invite. */
export const MemberJoinedEvent = z.object({ type: z.literal('member_joined'), user: User });

/**
 * Events stored in the event log and replayed after a reconnect. Apply them idempotently: a
 * client may see one twice around a reconnect. Rooms and messages add their events in M1 step 5.
 */
export const DurableEvent = z.discriminatedUnion('type', [MemberJoinedEvent]);
export type DurableEvent = z.infer<typeof DurableEvent>;

// ---- client → server ------------------------------------------------------------------------

export const ClientHello = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int(),
  clientVersion: z.string().min(1).max(64),
  /** The same short-lived token as HTTP requests use. */
  accessToken: z.string().min(1).max(4096),
  /** Last durable event sequence the client applied; omitted on a fresh start. */
  lastSeq: z.number().int().nonnegative().optional(),
});
export type ClientHello = z.infer<typeof ClientHello>;

export const ClientPing = z.object({ type: z.literal('ping') });
export type ClientPing = z.infer<typeof ClientPing>;

/** The user picked Müsait or Meşgul. Remembered across sessions. */
export const ClientSetPresence = z.object({ type: z.literal('set_presence'), mode: PresenceMode });
export type ClientSetPresence = z.infer<typeof ClientSetPresence>;

/** The computer went idle (10 minutes without input) or came back. */
export const ClientActivity = z.object({ type: z.literal('activity'), idle: z.boolean() });
export type ClientActivity = z.infer<typeof ClientActivity>;

export const ClientMessage = z.discriminatedUnion('type', [
  ClientHello,
  ClientPing,
  ClientSetPresence,
  ClientActivity,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- server → client ------------------------------------------------------------------------

export const ServerWelcome = z.object({
  type: z.literal('welcome'),
  serverVersion: z.string(),
  protocolVersion: z.number().int(),
  /** The newest durable event when this connection started. */
  seq: z.number().int().nonnegative(),
  /**
   * True when the client's `lastSeq` can't be caught up from the log (too old, or from a reset
   * server): reload state over HTTP and continue from `seq`. Otherwise missed events follow.
   */
  resync: z.boolean(),
  me: User,
  /** Everyone who is not offline. */
  presence: z.record(Id, PresenceStatus),
});
export type ServerWelcome = z.infer<typeof ServerWelcome>;

export const ServerEvent = z.object({
  type: z.literal('event'),
  seq: z.number().int().positive(),
  event: DurableEvent,
});
export type ServerEvent = z.infer<typeof ServerEvent>;

export const ServerPresence = z.object({
  type: z.literal('presence'),
  userId: Id,
  status: PresenceStatus,
});
export type ServerPresence = z.infer<typeof ServerPresence>;

export const ServerUpgradeRequired = z.object({
  type: z.literal('upgrade_required'),
  minProtocolVersion: z.number().int(),
  maxProtocolVersion: z.number().int(),
});
export type ServerUpgradeRequired = z.infer<typeof ServerUpgradeRequired>;

export const ServerPong = z.object({ type: z.literal('pong') });
export type ServerPong = z.infer<typeof ServerPong>;

export const ServerError = z.object({
  type: z.literal('error'),
  code: z.enum(['bad_message', 'hello_required', 'unauthorized']),
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerError>;

export const ServerMessage = z.discriminatedUnion('type', [
  ServerWelcome,
  ServerEvent,
  ServerPresence,
  ServerUpgradeRequired,
  ServerPong,
  ServerError,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** WebSocket close codes used by the gateway (4000–4999 are application-defined). */
export const GatewayCloseCode = {
  upgradeRequired: 4001,
  protocolViolation: 4002,
  /** The access token was invalid or the session ended; refresh, and sign in again if that fails. */
  unauthorized: 4003,
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

// ---- HTTP ------------------------------------------------------------------------------------

/** `GET /members`: everyone who has not been removed (A42). */
export const MemberList = z.object({ members: z.array(User) });
export type MemberList = z.infer<typeof MemberList>;
