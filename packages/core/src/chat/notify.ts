import type { Message, RoomPrefs } from '@hasbihal/protocol';

/** What can make a notification (A28, A13, A15). */
export type Occasion =
  | { kind: 'message'; message: Message; prefs: RoomPrefs }
  | { kind: 'hangout_started'; prefs: RoomPrefs }
  | { kind: 'nudge' }
  /** Someone knocks on a Mahrem room this member is on the list of (A55). */
  | { kind: 'knock' }
  | { kind: 'event_reminder' }
  /** Admins: someone not on the list asked to join (A25). */
  | { kind: 'access_request' };

export interface Situation {
  myId: string;
  /** Busy (A19): nothing notifies. */
  busy: boolean;
  /** The window is focused and showing this room: they're already looking. */
  viewingRoom: boolean;
  now: number;
}

export interface Notice {
  notify: boolean;
  sound: boolean;
}

const QUIET: Notice = { notify: false, sound: false };
/** Messages older than this, arriving after a reconnect, are history, not news. */
const FRESH_MS = 2 * 60 * 1000;

/** Whether a message names this member, directly or with @everyone. */
export const mentionsMe = (message: Message, myId: string) =>
  message.mentionsEveryone || message.mentions.includes(myId);

/**
 * The notification rules (A28): mentions, nudges, knocks (A55), and event reminders notify, with sound; access
 * requests (admins, A25) without; every message only where asked for; "hangout started" unless
 * turned off; a muted room says nothing; Busy (A19) silences all of it.
 */
export function noticeFor(occasion: Occasion, situation: Situation): Notice {
  if (situation.busy) return QUIET;
  switch (occasion.kind) {
    case 'nudge':
    case 'knock':
    case 'event_reminder':
      // Asked for personally: even a muted room doesn't hide them.
      return { notify: true, sound: true };
    case 'access_request':
      // Worth knowing, nobody waiting on the line: no sound.
      return { notify: true, sound: false };
    case 'hangout_started':
      return occasion.prefs.notify !== 'muted' && occasion.prefs.hangoutAlerts
        ? { notify: true, sound: false }
        : QUIET;
    case 'message': {
      const { message, prefs } = occasion;
      if (message.authorId === situation.myId || message.deletedAt) return QUIET;
      if (situation.now - Date.parse(message.createdAt) > FRESH_MS) return QUIET;
      if (prefs.notify === 'muted' || situation.viewingRoom) return QUIET;
      if (mentionsMe(message, situation.myId)) return { notify: true, sound: true };
      return prefs.notify === 'all' ? { notify: true, sound: prefs.sound } : QUIET;
    }
  }
}
