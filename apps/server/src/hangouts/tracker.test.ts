import { describe, expect, it } from 'vitest';
import { HangoutTracker } from './tracker.ts';

const room = '0192f0c4-7b5e-7c8e-9a3b-0000000000a1';
const ayse = '0192f0c4-7b5e-7c8e-9a3b-0000000000b1';
const kerem = '0192f0c4-7b5e-7c8e-9a3b-0000000000b2';

function setup() {
  const changes: [string, string[]][] = [];
  const started: string[] = [];
  const tracker = new HangoutTracker({
    changed: (roomId, people) => changes.push([roomId, people.map((p) => p.userId)]),
    started: (_roomId, userId) => started.push(userId),
  });
  return { tracker, changes, started };
}

describe('HangoutTracker', () => {
  it('announces joins and leaves, and "started" only when a room was empty', () => {
    const { tracker, changes, started } = setup();
    tracker.join(room, ayse, new Date());
    tracker.join(room, kerem, new Date());
    tracker.join(room, kerem, new Date()); // a reconnect: no change
    tracker.leave(room, ayse);
    tracker.leave(room, kerem);
    expect(started).toEqual([ayse]);
    expect(changes.map(([, people]) => people)).toEqual([[ayse], [ayse, kerem], [kerem], []]);
    expect(tracker.snapshot()).toEqual({});
  });

  it('tracks camera and screen share', () => {
    const { tracker } = setup();
    tracker.join(room, ayse, new Date());
    tracker.setTrack(room, ayse, 'camera', true);
    tracker.setTrack(room, ayse, 'screenShare', true);
    tracker.setTrack(room, ayse, 'camera', false);
    expect(tracker.participants(room)[0]).toMatchObject({ camera: false, screenShare: true });
  });

  it('reconciles with LiveKit: removes ghosts, adds the missed, stays quiet when equal', () => {
    const { tracker, changes } = setup();
    tracker.join(room, ayse, new Date()); // Ayşe left while the server was down: a ghost
    const joinedAt = new Date().toISOString();
    const actual = new Map([
      [room, [{ userId: kerem, joinedAt, camera: true, screenShare: false }]],
    ]);
    tracker.reconcile(actual);
    expect(tracker.participants(room)).toEqual([
      { userId: kerem, joinedAt, camera: true, screenShare: false },
    ]);
    const before = changes.length;
    tracker.reconcile(actual);
    expect(changes).toHaveLength(before);
  });
});
