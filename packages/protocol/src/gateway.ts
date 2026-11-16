import { z } from 'zod';
import { User } from './auth.ts';
import { Message, Room, RoomPrefs } from './chat.ts';
import { HangoutParticipant } from './hangout.ts';
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
/** Display name or photo changed: the member as they are now. */
export const MemberUpdatedEvent = z.object({ type: z.literal('member_updated'), user: User });
export const RoomCreatedEvent = z.object({ type: z.literal('room_created'), room: Room });
/** Renamed, topic changed, archived, or unarchived: the room as it is now. */
export const RoomUpdatedEvent = z.object({ type: z.literal('room_updated'), room: Room });
/** The room and all its messages are gone. */
export const RoomDeletedEvent = z.object({ type: z.literal('room_deleted'), roomId: Id });
export const MessageCreatedEvent = z.object({
  type: z.literal('message_created'),
  message: Message,
});
/** Edited or deleted: the message as it is now (a deleted one has an empty body). */
export const MessageUpdatedEvent = z.object({
  type: z.literal('message_updated'),
  message: Message,
});
export const ReactionAddedEvent = z.object({
  type: z.literal('reaction_added'),
  roomId: Id,
  messageId: Id,
  userId: Id,
  emoji: z.string(),
});
export const ReactionRemovedEvent = ReactionAddedEvent.extend({
  type: z.literal('reaction_removed'),
});

/** A room's events changed (one created, edited, skipped, moved, RSVP'd): reload them. */
export const EventsChangedEvent = z.object({ type: z.literal('events_changed'), roomId: Id });

/**
 * Events stored in the event log and replayed after a reconnect. Apply them idempotently: a
 * client may see one twice around a reconnect. Events carry whole objects where they can, so
 * applying one never depends on having seen the one before.
 */
export const DurableEvent = z.discriminatedUnion('type', [
  MemberJoinedEvent,
  MemberUpdatedEvent,
  RoomCreatedEvent,
  RoomUpdatedEvent,
  RoomDeletedEvent,
  MessageCreatedEvent,
  MessageUpdatedEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  EventsChangedEvent,
]);
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

/** The user is typing in a room. Send at most every few seconds while typing. */
export const ClientTyping = z.object({ type: z.literal('typing'), roomId: Id });
export type ClientTyping = z.infer<typeof ClientTyping>;

export const ClientMessage = z.discriminatedUnion('type', [
  ClientHello,
  ClientPing,
  ClientSetPresence,
  ClientActivity,
  ClientTyping,
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
  /** Who is in each room's hangout right now; rooms nobody is in are left out. */
  hangouts: z.record(Id, z.array(HangoutParticipant)),
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

/** A room's hangout changed: everyone in it now (empty when the last one left). */
export const ServerHangout = z.object({
  type: z.literal('hangout'),
  roomId: Id,
  participants: z.array(HangoutParticipant),
});
export type ServerHangout = z.infer<typeof ServerHangout>;

/** Someone joined an empty room (A28). Not sent to people in Busy mode (A19). */
export const ServerHangoutStarted = z.object({
  type: z.literal('hangout_started'),
  roomId: Id,
  userId: Id,
});
export type ServerHangoutStarted = z.infer<typeof ServerHangoutStarted>;

/** "Ömer wants you in Salon" (A13): a strong notification that joins the room when clicked. */
export const ServerNudge = z.object({ type: z.literal('nudge'), fromUserId: Id, roomId: Id });
export type ServerNudge = z.infer<typeof ServerNudge>;

/** An event the member is invited to starts soon (A15): a reminder notification. */
export const ServerEventReminder = z.object({
  type: z.literal('event_reminder'),
  eventId: Id,
  roomId: Id,
  title: z.string(),
  startsAt: z.iso.datetime(),
});
export type ServerEventReminder = z.infer<typeof ServerEventReminder>;

/** Someone is typing (ephemeral): show it for `TYPING_TTL_MS` unless repeated. */
export const ServerTyping = z.object({ type: z.literal('typing'), roomId: Id, userId: Id });
export type ServerTyping = z.infer<typeof ServerTyping>;
export const TYPING_TTL_MS = 6_000;

/** This member read up to a message, on one of their devices: update badges on all of them. */
export const ServerReadState = z.object({
  type: z.literal('read_state'),
  roomId: Id,
  lastReadMessageId: Id,
});
export type ServerReadState = z.infer<typeof ServerReadState>;

/** This member changed how they hear about a room, possibly on another device. */
export const ServerRoomPrefs = z.object({
  type: z.literal('room_prefs'),
  roomId: Id,
  prefs: RoomPrefs,
});
export type ServerRoomPrefs = z.infer<typeof ServerRoomPrefs>;

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
  ServerTyping,
  ServerReadState,
  ServerRoomPrefs,
  ServerHangout,
  ServerHangoutStarted,
  ServerNudge,
  ServerEventReminder,
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
