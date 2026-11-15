import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromWall, toWall } from '@hasbihal/core';
import { EventWindow, Room, RoomEvent, type SignedIn } from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
let ayse: SignedIn;
let kerem: SignedIn;
let room: Room;

const as = (who: SignedIn) => who.tokens.accessToken;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Next Monday 09:00 in Istanbul, at least a day away. */
function nextMondayNine(): Date {
  const wall = toWall(new Date(Date.now() + DAY), 'Europe/Istanbul');
  const daysToMonday = (8 - wall.getUTCDay()) % 7 || 7;
  const monday = new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + daysToMonday, 9),
  );
  return fromWall(monday, 'Europe/Istanbul');
}

const windowOf = async (who: SignedIn, from: Date, to: Date) => {
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    roomId: room.id,
  });
  const res = await h.request('GET', `/events?${query.toString()}`, as(who));
  expect(res.statusCode, res.body).toBe(200);
  return EventWindow.parse(res.json());
};

/** Queued reminders, soonest first. */
const reminders = () =>
  h.testDb.db
    .selectFrom('jobs')
    .select(['run_at', 'payload'])
    .where('kind', '=', 'event_reminder')
    .orderBy('run_at')
    .execute();

beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
  ayse = await h.signUp();
  kerem = await h.signUp();
  room = Room.parse((await h.request('POST', '/rooms', as(admin), { name: 'Ders' })).json());
});
afterAll(async () => {
  await h.close();
});

describe('events (A15, A16)', () => {
  it('runs the Monday "Ders" for three weeks, with a skip, a move, RSVPs, and reminders', async () => {
    const first = nextMondayNine();
    const created = await h.request('POST', '/events', as(admin), {
      roomId: room.id,
      title: 'Ders',
      description: 'Matematik',
      startsAt: first.toISOString(),
      durationMin: 60,
      recurrence: { freq: 'weekly', interval: 1, weekdays: [0] },
      reminderMin: 10,
      inviteeIds: [ayse.user.id, kerem.user.id],
    });
    expect(created.statusCode, created.body).toBe(201);
    const ders = RoomEvent.parse(created.json());
    expect(ders.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [0], until: null });

    // Members can't create events (A16).
    const denied = await h.request('POST', '/events', as(ayse), {
      roomId: room.id,
      title: 'Benim etkinliğim',
      startsAt: first.toISOString(),
      durationMin: 30,
    });
    expect(denied.statusCode).toBe(403);

    const end = new Date(first.getTime() + 3 * WEEK - DAY);
    const three = await windowOf(ayse, new Date(first.getTime() - DAY), end);
    expect(three.occurrences.map((o) => o.startsAt)).toEqual([
      first.toISOString(),
      new Date(first.getTime() + WEEK).toISOString(),
      new Date(first.getTime() + 2 * WEEK).toISOString(),
    ]);
    // The first reminder: ten minutes before the first lesson.
    expect((await reminders())[0]?.run_at.getTime()).toBe(first.getTime() - 10 * 60_000);

    // Week 2 is skipped; week 3 moves to Tuesday 10:00.
    const week2 = new Date(first.getTime() + WEEK).toISOString();
    const week3 = new Date(first.getTime() + 2 * WEEK).toISOString();
    const moved = new Date(first.getTime() + 2 * WEEK + DAY + 60 * 60_000).toISOString();
    expect(
      (
        await h.request('PUT', `/events/${ders.id}/occurrences/${week2}`, as(admin), {
          kind: 'skipped',
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await h.request('PUT', `/events/${ders.id}/occurrences/${week3}`, as(admin), {
          kind: 'moved',
          startsAt: moved,
        })
      ).statusCode,
    ).toBe(204);
    // Not an occurrence of this event.
    const wrong = new Date(first.getTime() + 3600_000).toISOString();
    expect(
      (
        await h.request('PUT', `/events/${ders.id}/occurrences/${wrong}`, as(admin), {
          kind: 'skipped',
        })
      ).statusCode,
    ).toBe(404);

    // RSVPs are per occurrence: Ayşe comes in week 1, can't in week 3.
    await h.request('PUT', `/events/${ders.id}/occurrences/${first.toISOString()}/rsvp`, as(ayse), {
      response: 'yes',
    });
    await h.request('PUT', `/events/${ders.id}/occurrences/${week3}/rsvp`, as(ayse), {
      response: 'no',
    });

    const after = await windowOf(
      kerem,
      new Date(first.getTime() - DAY),
      new Date(end.getTime() + DAY),
    );
    expect(after.occurrences.map((o) => [o.startsAt, o.skipped, o.moved, o.rsvps])).toEqual([
      [first.toISOString(), false, false, [{ userId: ayse.user.id, response: 'yes' }]],
      [week2, true, false, []],
      [moved, false, true, [{ userId: ayse.user.id, response: 'no' }]],
    ]);

    // Reminders on time for every invitee: make the first one due and run it.
    const [ayseClient, keremClient, adminClient] = await Promise.all([
      h.connect(as(ayse)),
      h.connect(as(kerem)),
      h.connect(as(admin)),
    ]);
    await Promise.all([ayseClient, keremClient, adminClient].map((c) => c.waitFor('welcome')));
    const queued = await reminders();
    expect(queued).toHaveLength(1); // older revisions' jobs were replaced by the latest change
    await sql`update jobs set run_at = now() where kind = 'event_reminder'`.execute(h.testDb.db);
    await h.app.jobs.runDue();
    for (const client of [ayseClient, keremClient]) {
      const reminder = await client.waitFor('event_reminder');
      expect(reminder).toMatchObject({
        eventId: ders.id,
        title: 'Ders',
        startsAt: first.toISOString(),
      });
    }
    // The admin isn't invited: no reminder.
    expect(adminClient.messages.some((m) => m.type === 'event_reminder')).toBe(false);

    // The next reminder skips week 2 and follows week 3 to its new time.
    const next = await reminders();
    expect(next.map((j) => j.run_at.getTime())).toEqual([new Date(moved).getTime() - 10 * 60_000]);
    for (const c of [ayseClient, keremClient, adminClient]) c.ws.terminate();
  });

  it('tells everyone to reload, and forgets a deleted event', async () => {
    const watcher = await h.connect(as(kerem));
    await watcher.waitFor('welcome');
    const created = RoomEvent.parse(
      (
        await h.request('POST', '/events', as(admin), {
          roomId: room.id,
          title: 'Çay saati',
          startsAt: new Date(Date.now() + 2 * DAY).toISOString(),
          durationMin: 30,
        })
      ).json(),
    );
    await watcher.waitFor('event', (m) => m.event.type === 'events_changed');
    expect((await h.request('DELETE', `/events/${created.id}`, as(admin))).statusCode).toBe(204);
    const window = await windowOf(kerem, new Date(), new Date(Date.now() + 7 * DAY));
    expect(window.events.map((e) => e.title)).not.toContain('Çay saati');
    watcher.ws.terminate();
  });
});
