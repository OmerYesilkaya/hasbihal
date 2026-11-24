import { z } from 'zod';
import { Id } from './id.ts';

// Hangouts: the drop-in voice and video area of each room (DECISIONS A6, A11; ARCHITECTURE §6).

/** Someone in a room's hangout, as the server learns it from LiveKit. */
export const HangoutParticipant = z.object({
  userId: Id,
  joinedAt: z.iso.datetime(),
  camera: z.boolean(),
  /** Sharing their screen: drives the "CANLI" badge (M3). */
  screenShare: z.boolean(),
});
export type HangoutParticipant = z.infer<typeof HangoutParticipant>;

/** `POST /rooms/:id/hangout/token`: connect to LiveKit at `url` with `token`. */
export const HangoutToken = z.object({ url: z.string(), token: z.string() });
export type HangoutToken = z.infer<typeof HangoutToken>;

/** `POST /nudges` (A13): "Ömer wants you in Salon". */
export const NudgeRequest = z.object({ toUserId: Id, roomId: Id });
export type NudgeRequest = z.infer<typeof NudgeRequest>;

/** Whether the nudge reached one of the recipient's devices (they may be offline). */
export const NudgeResult = z.object({ delivered: z.boolean() });
export type NudgeResult = z.infer<typeof NudgeResult>;

/** Per sender and recipient (ARCHITECTURE §6.4). */
export const NUDGE_COOLDOWN_MS = 60_000;

// ---- Mahrem rooms (A55; ARCHITECTURE §6.1) --------------------------------------------------

/** The most people a Mahrem list holds: everyone, at the family's size (A34). */
export const MAHREM_LIST_MAX = 100;

/**
 * `PUT /rooms/:id/mahrem`: turn it on, or change who is on the list. Turning it on, the list
 * must include the person doing it.
 */
export const SetMahremRequest = z.object({
  memberIds: z
    .array(Id)
    .min(1)
    .max(MAHREM_LIST_MAX)
    .refine((ids) => new Set(ids).size === ids.length, 'Someone is on the list twice.'),
});
export type SetMahremRequest = z.infer<typeof SetMahremRequest>;

/** `POST /rooms/:id/mahrem/knock`: whether anyone on the list heard it (they may be offline). */
export const KnockResult = z.object({ delivered: z.boolean() });
export type KnockResult = z.infer<typeof KnockResult>;

/** `POST /rooms/:id/mahrem/knocks/:userId`: let them in for this call, or turn them away. */
export const AnswerKnockRequest = z.object({ admit: z.boolean() });
export type AnswerKnockRequest = z.infer<typeof AnswerKnockRequest>;

/** Per knocker and room. */
export const KNOCK_COOLDOWN_MS = 30_000;
/** A knock nobody answered lapses; so does a pass nobody used. */
export const KNOCK_TTL_MS = 2 * 60_000;
