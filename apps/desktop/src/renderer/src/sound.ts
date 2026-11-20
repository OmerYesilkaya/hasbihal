import alertUrl from './sounds/alert.mp3';
import clickUrl from './sounds/click.mp3';
import errorUrl from './sounds/error.mp3';
import joinedUrl from './sounds/joined-call.mp3';
import leftUrl from './sounds/left-call.mp3';
import ring0Url from './sounds/ring0.mp3';
import ring1Url from './sounds/ring1.mp3';

/**
 * The app's sound effects (#37): bundled files played through Web Audio, so they sound the same
 * on macOS and Windows and never wait on the system's notification sound.
 */
const FILES = {
  /** A notification (A28): a message, a hangout starting, an event reminder. */
  alert: alertUrl,
  /** Muting, unmuting, deafening, undeafening yourself. */
  click: clickUrl,
  /** Something went wrong (an error toast). */
  error: errorUrl,
  /** You, or someone else, joined your call. */
  joined: joinedUrl,
  /** You, or someone else, left your call. */
  left: leftUrl,
  /** Ringtones, for someone calling you to their call (a nudge); one is chosen in Settings. */
  ring0: ring0Url,
  ring1: ring1Url,
} as const;

export type Sound = keyof typeof FILES;
export const RINGTONES = ['ring0', 'ring1'] as const satisfies readonly Sound[];
export type Ringtone = (typeof RINGTONES)[number];

export interface SoundSettings {
  /** 0–1; 0 is off. */
  volume: number;
  ringtone: Ringtone;
}

const SETTINGS_KEY = 'hasbihal.sounds';
const DEFAULT_SETTINGS: SoundSettings = { volume: 0.7, ringtone: 'ring0' };

function loadSettings(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<SoundSettings>;
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    if (!RINGTONES.includes(settings.ringtone)) settings.ringtone = DEFAULT_SETTINGS.ringtone;
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let settings = loadSettings();
/** Stops the ringtone playing now, if one is. */
let stopRinging: (() => void) | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

/** The settings, and whether a ringtone is playing, for useSyncExternalStore. */
export const soundSettings = {
  get: (): SoundSettings => settings,
  ringing: (): boolean => stopRinging !== null,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  update: (change: Partial<SoundSettings>): void => {
    settings = { ...settings, ...change };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    changed();
  },
};

let context: AudioContext | null = null;
const buffers = new Map<Sound, Promise<AudioBuffer | null>>();

function audioContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
    // Decode everything once up front, so the first join or click isn't late.
    for (const sound of Object.keys(FILES) as Sound[]) void load(sound);
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

function load(sound: Sound): Promise<AudioBuffer | null> {
  let buffer = buffers.get(sound);
  if (!buffer) {
    const ctx = audioContext();
    buffer = fetch(FILES[sound])
      .then((response) => response.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    buffers.set(sound, buffer);
  }
  return buffer;
}

/**
 * Plays a sound at the chosen volume; the returned function stops it (with a short fade).
 * `onEnded` runs once it's over, played through, stopped or not played at all.
 */
export function playSound(sound: Sound, onEnded?: () => void): () => void {
  const { volume } = settings;
  if (volume <= 0) {
    onEnded?.();
    return () => undefined;
  }
  const ctx = audioContext();
  let stopped = false;
  let stop = () => {
    stopped = true;
  };
  void load(sound).then((buffer) => {
    if (!buffer || stopped) {
      onEnded?.();
      return;
    }
    const source = ctx.createBufferSource();
    source.onended = () => onEnded?.();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
    stop = () => {
      const at = ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + 0.08);
      source.stop(at + 0.1);
    };
  });
  return () => {
    stop();
  };
}

/** Rings with the chosen ringtone (once through); a new ring replaces one still playing. */
export function ring(ringtone: Ringtone = settings.ringtone): void {
  stopRing();
  if (settings.volume <= 0) return;
  // With sound on, onEnded comes later, once `stop` is set.
  const stop = playSound(ringtone, () => {
    if (stopRinging !== stop) return; // stopped, or a newer ring took over
    stopRinging = null;
    changed();
  });
  stopRinging = stop;
  changed();
}

/** Stops the ringing, e.g. once the call it was for is joined. */
export function stopRing(): void {
  if (!stopRinging) return;
  const stop = stopRinging;
  stopRinging = null;
  stop();
  changed();
}
