import { describe, expect, it } from 'vitest';
import type { User } from '@hasbihal/protocol';
import { ChatStore, sortMembers } from './store.ts';

const user = (id: string, displayName: string): User => ({
  id,
  username: displayName.toLowerCase(),
  displayName,
  avatarColor: 0,
  role: 'member',
  createdAt: '2026-11-15T10:00:00.000Z',
});
const ayse = user('0192f0c4-7b5e-7c8e-9a3b-000000000001', 'Ayşe');
const cem = user('0192f0c4-7b5e-7c8e-9a3b-000000000002', 'Cem');
const ismail = user('0192f0c4-7b5e-7c8e-9a3b-000000000003', 'İsmail');

describe('ChatStore', () => {
  it('applies member_joined idempotently', () => {
    const store = new ChatStore();
    store.apply({ type: 'member_joined', user: ayse });
    const before = store.getSnapshot();
    store.apply({ type: 'member_joined', user: ayse });
    expect([...store.getSnapshot().members.values()]).toEqual([...before.members.values()]);
  });

  it('keeps members that joined while a full load was in flight', () => {
    const store = new ChatStore();
    store.apply({ type: 'member_joined', user: cem }); // arrived during the load
    store.setMembers([ayse]); // the load, taken before Cem joined
    expect(new Set(store.getSnapshot().members.keys())).toEqual(new Set([ayse.id, cem.id]));
  });

  it('notifies only on change and gives a new snapshot each time', () => {
    const store = new ChatStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.setPresence(ayse.id, 'available');
    const snapshot = store.getSnapshot();
    store.setPresence(ayse.id, 'available');
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(snapshot);
    store.setPresence(ayse.id, 'offline');
    expect(store.getSnapshot().presence.has(ayse.id)).toBe(false);
  });

  it('sorts present members first, then by Turkish alphabetical order', () => {
    const store = new ChatStore();
    store.setMembers([ismail, cem, ayse]);
    store.setPresence(ismail.id, 'busy');
    // İsmail is present; Ayşe and Cem are offline, in Turkish order.
    expect(sortMembers(store.getSnapshot()).map((u) => u.displayName)).toEqual([
      'İsmail',
      'Ayşe',
      'Cem',
    ]);
  });
});
