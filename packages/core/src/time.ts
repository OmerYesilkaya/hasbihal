// Wall-clock time in a time zone (DECISIONS A17: everything happens in Europe/Istanbul).

/** The zone all events and times are in (A17). */
export const TIME_ZONE = 'Europe/Istanbul';

/**
 * Wall-clock time in a zone, as a "floating" Date whose UTC fields are that wall time. The rrule
 * library works in such floating time, so "every Monday 09:00" stays 09:00 in Istanbul (A17).
 */
export function toWall(instant: Date, tz: string = TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')),
  );
}

/** The instant a zone's wall-clock time names (the inverse of `toWall`). */
export function fromWall(wall: Date, tz: string = TIME_ZONE): Date {
  // The zone's offset near that time, refined once for the rare zone that changes it (Istanbul
  // hasn't since 2016, but the data says what it says).
  let guess = new Date(wall.getTime() - (toWall(wall, tz).getTime() - wall.getTime()));
  guess = new Date(wall.getTime() - (toWall(guess, tz).getTime() - guess.getTime()));
  return guess;
}
