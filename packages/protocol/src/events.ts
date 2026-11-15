import { z } from 'zod';
import { Id } from './id.ts';

// Events in rooms (ARCHITECTURE §8, DECISIONS A15, A16, A17).

export const EVENT_TITLE_MAX = 80;
export const EVENT_DESCRIPTION_MAX = 500;
/** The longest window one `GET /events` expands. */
export const EVENT_WINDOW_MAX_DAYS = 62;
export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

const text = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(min).max(max));

/** 0 = Monday … 6 = Sunday, as people in Turkey count the week. */
export const Weekday = z.number().int().min(0).max(6);

/**
 * How an event repeats: the subset of RFC 5545 the app offers. Stored as an RRULE, read in
 * Europe/Istanbul wall time ("every Monday 09:00" stays 09:00).
 */
export const Recurrence = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  /** Every 1st, 2nd, … day/week/month. */
  interval: z.number().int().min(1).max(4),
  /** Weekly: which days; empty means the first occurrence's day. */
  weekdays: z.array(Weekday).max(7).default([]),
  /** The last day it may happen on (inclusive, `YYYY-MM-DD` in Istanbul), or forever. */
  until: z.iso.date().nullable().default(null),
});
export type Recurrence = z.infer<typeof Recurrence>;

export const RoomEvent = z.object({
  id: Id,
  roomId: Id,
  title: z.string(),
  description: z.string().nullable(),
  /** The first occurrence. */
  startsAt: z.iso.datetime(),
  durationMin: z.number().int().positive(),
  recurrence: Recurrence.nullable(),
  /** Minutes before each start; 0 means no reminder. */
  reminderMin: z.number().int().nonnegative(),
  /** Who gets reminders. Anyone may still come (A8, A15). */
  inviteeIds: z.array(Id),
  createdBy: Id,
});
export type RoomEvent = z.infer<typeof RoomEvent>;

export const RsvpResponse = z.enum(['yes', 'no']);
export type RsvpResponse = z.infer<typeof RsvpResponse>;

/** One time an event happens. `start` (its scheduled time) names it, even when moved. */
export const Occurrence = z.object({
  eventId: Id,
  start: z.iso.datetime(),
  /** When it actually happens: `start`, or where it was moved to. */
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  skipped: z.boolean(),
  moved: z.boolean(),
  rsvps: z.array(z.object({ userId: Id, response: RsvpResponse })),
});
export type Occurrence = z.infer<typeof Occurrence>;

// ---- HTTP ------------------------------------------------------------------------------------

/** `GET /events?from=…&to=…[&roomId=…]`: occurrences in the window, by actual start. */
export const EventWindowQuery = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  roomId: Id.optional(),
});
export type EventWindowQuery = z.infer<typeof EventWindowQuery>;

export const EventWindow = z.object({
  events: z.array(RoomEvent),
  /** In order of `startsAt`. */
  occurrences: z.array(Occurrence),
});
export type EventWindow = z.infer<typeof EventWindow>;

export const SaveEventRequest = z.object({
  roomId: Id,
  title: text(1, EVENT_TITLE_MAX),
  description: text(0, EVENT_DESCRIPTION_MAX).nullable().default(null),
  startsAt: z.iso.datetime(),
  durationMin: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  recurrence: Recurrence.nullable().default(null),
  reminderMin: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .default(10),
  inviteeIds: z.array(Id).max(100).default([]),
});
export type SaveEventRequest = z.input<typeof SaveEventRequest>;

/** Skip one occurrence, or move it (A16). */
export const OccurrenceChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skipped') }),
  z.object({ kind: z.literal('moved'), startsAt: z.iso.datetime() }),
]);
export type OccurrenceChange = z.infer<typeof OccurrenceChange>;

export const RsvpRequest = z.object({ response: RsvpResponse });
export type RsvpRequest = z.infer<typeof RsvpRequest>;
