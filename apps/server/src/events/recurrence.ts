import rrule from 'rrule';
import { fromWall, toWall } from '@hasbihal/core';
import type { Recurrence } from '@hasbihal/protocol';

const { RRule, Weekday } = rrule;

/** RFC 5545 days, Monday first like the app's weekday numbers. */
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
/** No window expands to more than this many occurrences (a daily event over two months is 62). */
const MAX_OCCURRENCES = 500;

/** The RRULE (without DTSTART) for the app's recurrence choices. */
export function toRRule(recurrence: Recurrence): string {
  const parts = [
    `FREQ=${recurrence.freq.toUpperCase()}`,
    `INTERVAL=${String(recurrence.interval)}`,
  ];
  if (recurrence.freq === 'weekly' && recurrence.weekdays.length) {
    const days = [...new Set(recurrence.weekdays)].sort((a, b) => a - b);
    parts.push(`BYDAY=${days.map((d) => DAYS[d] ?? 'MO').join(',')}`);
  }
  // The end of the last day, in wall time.
  if (recurrence.until) parts.push(`UNTIL=${recurrence.until.replaceAll('-', '')}T235959Z`);
  return parts.join(';');
}

/** The app's recurrence for a stored RRULE (only ever one `toRRule` made). */
export function fromRRule(text: string): Recurrence {
  const options = RRule.parseString(text);
  const freq =
    options.freq === RRule.DAILY ? 'daily' : options.freq === RRule.MONTHLY ? 'monthly' : 'weekly';
  const byday = options.byweekday;
  const weekdays = (
    Array.isArray(byday) ? byday : byday === undefined || byday === null ? [] : [byday]
  )
    .map((d) => (d instanceof Weekday ? d.weekday : typeof d === 'number' ? d : DAYS.indexOf(d)))
    .filter((d) => d >= 0);
  const until = options.until ? options.until.toISOString().slice(0, 10) : null;
  return { freq, interval: options.interval ?? 1, weekdays, until };
}

/**
 * The scheduled starts of an event that may overlap [from, to): its occurrences are expanded on
 * read, never stored (ARCHITECTURE §8).
 */
export function scheduledStarts(
  event: { starts_at: Date; duration_min: number; rrule: string | null; tz: string },
  from: Date,
  to: Date,
): Date[] {
  const earliest = new Date(from.getTime() - event.duration_min * 60_000);
  if (!event.rrule)
    return event.starts_at >= earliest && event.starts_at < to ? [event.starts_at] : [];
  const rule = new RRule({
    ...RRule.parseString(event.rrule),
    dtstart: toWall(event.starts_at, event.tz),
  });
  const starts: Date[] = [];
  rule.between(toWall(earliest, event.tz), toWall(to, event.tz), true, (wall) => {
    const instant = fromWall(wall, event.tz);
    if (instant >= earliest && instant < to) starts.push(instant);
    return starts.length < MAX_OCCURRENCES;
  });
  return starts;
}

/** The first scheduled start strictly after `after`, or null when the series has ended. */
export function nextScheduledStart(
  event: { starts_at: Date; rrule: string | null; tz: string },
  after: Date,
): Date | null {
  if (!event.rrule) return event.starts_at > after ? event.starts_at : null;
  const rule = new RRule({
    ...RRule.parseString(event.rrule),
    dtstart: toWall(event.starts_at, event.tz),
  });
  const wall = rule.after(toWall(after, event.tz), false);
  return wall ? fromWall(wall, event.tz) : null;
}
