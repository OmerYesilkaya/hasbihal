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
