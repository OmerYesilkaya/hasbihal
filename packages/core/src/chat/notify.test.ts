import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_PREFS, type Message, type RoomPrefs } from '@hasbihal/protocol';
import { noticeFor, type Situation } from './notify.ts';

const ME = '0192f0c4-7b5e-7c8e-9a3b-0000000000aa';
const AYSE = '0192f0c4-7b5e-7c8e-9a3b-0000000000bb';
const NOW = Date.parse('2026-11-16T10:00:00.000Z');

const message = (extra: Partial<Message> = {}): Message => ({
  id: '0192f0c4-7b5e-7c8e-9a3b-000000000001',
  roomId: '0192f0c4-7b5e-7c8e-9a3b-0000000000c1',
  authorId: AYSE,
  body: 'çay hazır',
  replyTo: null,
  mentions: [],
  mentionsEveryone: false,
  reactions: [],
  attachments: [],
  previews: [],
  createdAt: '2026-11-16T09:59:30.000Z',
  editedAt: null,
  deletedAt: null,
  ...extra,
});
const at: Situation = { myId: ME, busy: false, viewingRoom: false, now: NOW };
const prefs = (change: Partial<RoomPrefs> = {}) => ({ ...DEFAULT_ROOM_PREFS, ...change });
const forMessage = (m: Message, p = prefs(), s = at) =>
  noticeFor({ kind: 'message', message: m, prefs: p }, s);

describe('notification rules (A28)', () => {
  it('keeps ordinary messages quiet by default, and mentions loud', () => {
    expect(forMessage(message())).toEqual({ notify: false, sound: false });
    expect(forMessage(message({ mentions: [ME] }))).toEqual({ notify: true, sound: true });
    expect(forMessage(message({ mentionsEveryone: true }))).toEqual({ notify: true, sound: true });
  });

  it('notifies every message where asked, with sound only if asked', () => {
    expect(forMessage(message(), prefs({ notify: 'all' }))).toEqual({ notify: true, sound: false });
    expect(forMessage(message(), prefs({ notify: 'all', sound: true }))).toEqual({
      notify: true,
      sound: true,
    });
  });

  it('says nothing for a muted room, its own messages, old news, or a room being read', () => {
    expect(forMessage(message({ mentions: [ME] }), prefs({ notify: 'muted' })).notify).toBe(false);
    expect(forMessage(message({ authorId: ME, mentions: [ME] })).notify).toBe(false);
    expect(
      forMessage(message({ mentions: [ME], createdAt: '2026-11-16T09:50:00.000Z' })).notify,
    ).toBe(false);
    expect(
      forMessage(message({ mentions: [ME] }), prefs(), { ...at, viewingRoom: true }).notify,
    ).toBe(false);
  });

  it('announces hangouts unless turned off or muted, and always nudges and reminders', () => {
    expect(noticeFor({ kind: 'hangout_started', prefs: prefs() }, at).notify).toBe(true);
    expect(
      noticeFor({ kind: 'hangout_started', prefs: prefs({ hangoutAlerts: false }) }, at).notify,
    ).toBe(false);
    expect(
      noticeFor({ kind: 'hangout_started', prefs: prefs({ notify: 'muted' }) }, at).notify,
    ).toBe(false);
    expect(noticeFor({ kind: 'nudge' }, at)).toEqual({ notify: true, sound: true });
    expect(noticeFor({ kind: 'event_reminder' }, at)).toEqual({ notify: true, sound: true });
  });

  it('is silent when Busy (A19)', () => {
    const busy = { ...at, busy: true };
    expect(forMessage(message({ mentions: [ME] }), prefs(), busy).notify).toBe(false);
    expect(noticeFor({ kind: 'nudge' }, busy).notify).toBe(false);
    expect(noticeFor({ kind: 'event_reminder' }, busy).notify).toBe(false);
  });
});
