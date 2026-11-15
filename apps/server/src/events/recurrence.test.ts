import { describe, expect, it } from 'vitest';
import { fromWall, toWall } from '@hasbihal/core';
import { fromRRule, nextScheduledStart, scheduledStarts, toRRule } from './recurrence.ts';

const TZ = 'Europe/Istanbul';
const at = (iso: string) => new Date(iso);
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe('wall time in Istanbul (A17)', () => {
  it('converts both ways at UTC+3', () => {
    expect(toWall(at('2026-11-16T06:00:00Z'), TZ).toISOString()).toBe('2026-11-16T09:00:00.000Z');
    expect(fromWall(at('2026-11-16T09:00:00Z'), TZ).toISOString()).toBe('2026-11-16T06:00:00.000Z');
  });
});

describe('recurrence', () => {
  it('round-trips the app’s choices through RRULE', () => {
    const weekly = { freq: 'weekly' as const, interval: 2, weekdays: [2, 0], until: '2027-01-31' };
    expect(toRRule(weekly)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270131T235959Z');
    expect(fromRRule(toRRule(weekly))).toEqual({ ...weekly, weekdays: [0, 2] });
    const monthly = { freq: 'monthly' as const, interval: 1, weekdays: [], until: null };
    expect(fromRRule(toRRule(monthly))).toEqual(monthly);
  });

  // "Ders", every Monday at 09:00 Istanbul, from Monday 16 November 2026.
  const ders = {
    starts_at: at('2026-11-16T06:00:00Z'),
    duration_min: 60,
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    tz: TZ,
  };

  it('expands a weekly event at the same wall time, in the window only', () => {
    expect(
      iso(scheduledStarts(ders, at('2026-11-20T00:00:00Z'), at('2026-12-08T00:00:00Z'))),
    ).toEqual(['2026-11-23T06:00:00.000Z', '2026-11-30T06:00:00.000Z', '2026-12-07T06:00:00.000Z']);
  });

  it('includes an occurrence still running at the start of the window', () => {
    expect(
      iso(scheduledStarts(ders, at('2026-11-16T06:30:00Z'), at('2026-11-17T00:00:00Z'))),
    ).toEqual(['2026-11-16T06:00:00.000Z']);
  });

  it('stops after the last day, and finds the next start', () => {
    const ending = { ...ders, rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261130T235959Z' };
    expect(
      scheduledStarts(ending, at('2026-11-01T00:00:00Z'), at('2027-01-01T00:00:00Z')),
    ).toHaveLength(3);
    expect(nextScheduledStart(ending, at('2026-11-16T06:00:00Z'))?.toISOString()).toBe(
      '2026-11-23T06:00:00.000Z',
    );
    expect(nextScheduledStart(ending, at('2026-11-30T06:00:00Z'))).toBeNull();
  });

  it('handles one-off events', () => {
    const once = { ...ders, rrule: null };
    expect(
      scheduledStarts(once, at('2026-11-16T00:00:00Z'), at('2026-11-17T00:00:00Z')),
    ).toHaveLength(1);
    expect(nextScheduledStart(once, at('2026-11-16T06:00:00Z'))).toBeNull();
  });
});
