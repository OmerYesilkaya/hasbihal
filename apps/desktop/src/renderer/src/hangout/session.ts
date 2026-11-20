import {
  AudioPresets,
  ConnectionState,
  createLocalVideoTrack,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  LocalVideoTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type VideoTrack,
} from 'livekit-client';
import type { MessageKey } from '@hasbihal/core';
import { HangoutToken } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Microphone, type InputMode, type MicSettings } from './microphone.ts';
import { SPEAKING_CHECK_MS, SpeakingDetector } from './speaking.ts';

/** One person in the call, as the grid shows them. */
export interface ParticipantView {
  userId: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  camera: VideoTrack | null;
}

/** A screen share (A14): one tile each; viewers choose which ones to watch. */
export interface ShareView {
  userId: string;
  isLocal: boolean;
  /** The video, when watching (always, for your own). */
  track: VideoTrack | null;
  /** Shared with the computer's sound. */
  hasAudio: boolean;
  watching: boolean;
}

/**
 * What a share is tuned for (A14). Motion keeps the frame rate (games, films); detail keeps
 * the resolution (text, code), so small letters stay sharp when the picture changes.
 */
export type SharePreset = 'motion' | 'detail';

const SHARE_ENCODING: Record<SharePreset, { maxBitrate: number; maxFramerate: number }> = {
  motion: { maxBitrate: 8_000_000, maxFramerate: 60 },
  detail: { maxBitrate: 6_000_000, maxFramerate: 30 },
};

/** The key a share's sound volume is remembered under, next to the person's voice volume. */
export const screenVolumeKey = (userId: string) => `${userId}:screen`;

export interface VoiceSettings extends MicSettings {
  cameraId: string | null;
  /** `KeyboardEvent.code` held for push-to-talk while the app is focused. */
  pttKey: string;
  /** Per-person volume, 0–2 (A29), by user id; a share's sound by `screenVolumeKey`. */
  volumes: Record<string, number>;
  sharePreset: SharePreset;
  shareAudio: boolean;
}

export interface HangoutState {
  roomId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  micMuted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  /** Sharing a screen or window now. */
  sharing: boolean;
  /** The mic couldn't be opened (no device, permission refused): listening only. */
  micUnavailable: boolean;
  noiseSuppressionAvailable: boolean;
  participants: ParticipantView[];
  shares: ShareView[];
  settings: VoiceSettings;
  /** Something the user should know, e.g. "noise suppression was switched off". */
  notice: MessageKey | null;
  /** Hearing yourself outside a call, to try the microphone and its settings. */
  micTest: boolean;
}

const SETTINGS_KEY = 'hasbihal.voice';
const DEFAULT_SETTINGS: VoiceSettings = {
  deviceId: null,
  cameraId: null,
  noiseSuppression: true,
  mode: 'voice',
  thresholdDb: -50,
  pttKey: 'AltRight',
  volumes: {},
  sharePreset: 'motion',
  shareAudio: true,
};

function loadSettings(): VoiceSettings {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<VoiceSettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * The one hangout this app is in (ARCHITECTURE §6): the LiveKit room, the processed microphone,
 * the camera, and the voice settings. React reads it as an external store.
 */
export class HangoutSession {
  #state: HangoutState = {
    roomId: null,
    status: 'idle',
    micMuted: false,
    deafened: false,
    cameraOn: false,
    sharing: false,
    micUnavailable: false,
    noiseSuppressionAvailable: true,
    participants: [],
    shares: [],
    settings: loadSettings(),
    notice: null,
    micTest: false,
  };
  readonly #listeners = new Set<() => void>();
  readonly #noticeListeners = new Set<(notice: MessageKey) => void>();
  readonly #serverUrl: string;
  #room: Room | null = null;
  #mic: Microphone | null = null;
  /** Who is speaking, from audio levels (#35); only while in a call. */
  #speaking: { detector: SpeakingDetector; timer: ReturnType<typeof setInterval> } | null = null;
  #speakers = new Set<string>();
  /** The microphone test (`startMicTest`) and what plays it back. */
  #testMic: { mic: Microphone; audio: HTMLAudioElement } | null = null;
  /** Counts starts and stops, so a test that finishes opening after a stop closes itself. */
  #testAttempt = 0;
  #micPublication: LocalTrackPublication | null = null;
  #camera: LocalVideoTrack | null = null;
  #screen: { video: LocalVideoTrack; audio: LocalAudioTrack | null } | null = null;
  /** Whose shares this viewer watches (A14); the rest aren't downloaded at all. */
  readonly #watching = new Set<string>();
  /** Remote audio elements, by track sid. */
  readonly #audioElements = new Map<string, HTMLMediaElement[]>();

  constructor(serverUrl: string) {
    this.#serverUrl = serverUrl;
  }

  getSnapshot = (): HangoutState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Problems worth telling the person about once (a toast), as they happen. */
  onNotice = (listener: (notice: MessageKey) => void): (() => void) => {
    this.#noticeListeners.add(listener);
    return () => this.#noticeListeners.delete(listener);
  };

  /** The microphone's level before the gate, for the sensitivity meter. */
  micLevelDb(): number {
    return (this.#mic ?? this.#testMic?.mic)?.levelDb ?? -100;
  }

  /**
   * Plays the microphone back, exactly as a call would send it (noise suppression, the voice or
   * push-to-talk gate), so people can try it and set the sensitivity by ear. Only outside a call;
   * joining one ends it.
   */
  async startMicTest(): Promise<void> {
    if (this.#state.roomId !== null || this.#state.micTest) return;
    const attempt = ++this.#testAttempt;
    this.#set({ micTest: true });
    try {
      const mic = await Microphone.open(this.#state.settings, () => {
        mic.dropNoiseSuppression();
      });
      // Stopped (or restarted, or a call started) while it opened.
      if (attempt !== this.#testAttempt) {
        mic.close();
        return;
      }
      const audio = new Audio();
      audio.srcObject = new MediaStream([mic.track]);
      this.#testMic = { mic, audio };
      await audio.play();
    } catch {
      this.stopMicTest();
      this.#set({ notice: 'hangout.micTestFailed' });
    }
  }

  stopMicTest(): void {
    this.#testAttempt++;
    if (this.#testMic) {
      this.#testMic.audio.pause();
      this.#testMic.audio.srcObject = null;
      this.#testMic.mic.close();
      this.#testMic = null;
    }
    if (this.#state.micTest) this.#set({ micTest: false });
  }

  async join(roomId: string): Promise<void> {
    if (this.#state.roomId === roomId) return;
    this.stopMicTest(); // one microphone at a time
    await this.leave();
    this.#set({ roomId, status: 'connecting', notice: null });

    const token = await api(this.#serverUrl, 'POST', `/rooms/${roomId}/hangout/token`, {
      schema: HangoutToken,
    });
    if (!token.ok || !token.value || this.#state.roomId !== roomId) {
      this.#set({ roomId: null, status: 'idle', notice: token.ok ? null : 'hangout.joinFailed' });
      return;
    }

    const room = new Room({
      // The app leaves explicitly (leave(), sign-out, quit). LiveKit's own page-leave handling
      // fires spuriously in Electron and drops the call right after it connects.
      disconnectOnPageLeave: false,
      adaptiveStream: true,
      dynacast: true,
      // Remote sound through Web Audio: per-person volume above 100% (A29) needs a gain node.
      webAudioMix: true,
      // T8: H.264 so the hardware encoder is used where there is one.
      publishDefaults: {
        videoCodec: 'h264',
        backupCodec: false,
        simulcast: true,
        dtx: false,
        red: true,
      },
    });
    this.#room = room;
    const refresh = () => {
      this.#refresh();
    };
    room
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.#syncSubscriptions(participant);
        refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.#watching.delete(participant.identity);
        refresh();
      })
      .on(RoomEvent.TrackPublished, (_publication, participant) => {
        this.#syncSubscriptions(participant);
        refresh();
      })
      .on(RoomEvent.TrackUnpublished, (publication, participant) => {
        if (publication.source === Track.Source.ScreenShare)
          this.#watching.delete(participant.identity);
        refresh();
      })
      .on(RoomEvent.TrackSubscribed, (track, publication) => {
        if (track.kind === Track.Kind.Audio) this.#attachAudio(track, publication.trackSid);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        if (track.kind === Track.Kind.Audio) this.#detachAudio(track, publication.trackSid);
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting)
          this.#set({ status: 'reconnecting' });
        else if (state === ConnectionState.Connected) this.#set({ status: 'connected' });
      })
      .on(RoomEvent.Disconnected, () => {
        // Kicked (e.g. the same user joined elsewhere) or connection lost for good.
        if (this.#room === room) void this.leave();
      });

    try {
      // Subscriptions are chosen per track (#syncSubscriptions): shares only when watched.
      await room.connect(token.value.url, token.value.token, { autoSubscribe: false });
    } catch {
      this.#room = null;
      this.#set({ roomId: null, status: 'idle', notice: 'hangout.joinFailed' });
      return;
    }
    if (this.#room !== room) return; // left while connecting
    this.#set({ status: 'connected' });
    for (const participant of room.remoteParticipants.values())
      this.#syncSubscriptions(participant);
    this.#startSpeakingCheck();
    this.#refresh(); // show the call at once; the mic can take a moment to load
    await this.#openMic();
    this.#refresh();
  }

  async leave(): Promise<void> {
    const room = this.#room;
    this.#room = null;
    this.#stopSpeakingCheck();
    this.#mic?.close();
    this.#mic = null;
    this.#micPublication = null;
    this.#camera?.stop();
    this.#camera = null;
    this.#stopScreenTracks();
    this.#watching.clear();
    for (const elements of this.#audioElements.values()) for (const el of elements) el.remove();
    this.#audioElements.clear();
    if (room) await room.disconnect();
    this.#set({
      roomId: null,
      status: 'idle',
      cameraOn: false,
      sharing: false,
      participants: [],
      shares: [],
    });
  }

  async toggleMute(): Promise<void> {
    if (this.#state.deafened) {
      await this.toggleDeafen(); // un-deafening unmutes too, as in Discord
      return;
    }
    await this.#setMicMuted(!this.#state.micMuted);
  }

  /** Deafen: hear nobody and be heard by nobody. */
  async toggleDeafen(): Promise<void> {
    const deafened = !this.#state.deafened;
    this.#set({ deafened });
    this.#applyVolumes();
    await this.#setMicMuted(deafened);
  }

  async toggleCamera(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    if (this.#camera) {
      await room.localParticipant.unpublishTrack(this.#camera);
      this.#camera.stop();
      this.#camera = null;
      this.#set({ cameraOn: false });
    } else {
      try {
        // ARCHITECTURE §6.2: up to 720p30, simulcast; viewers get only the layer they need.
        this.#camera = await createLocalVideoTrack({
          resolution: VideoPresets.h720.resolution,
          ...(this.#state.settings.cameraId
            ? { deviceId: { exact: this.#state.settings.cameraId } }
            : {}),
        });
        await room.localParticipant.publishTrack(this.#camera, { source: Track.Source.Camera });
        this.#set({ cameraOn: true, notice: null });
      } catch {
        this.#set({ notice: 'hangout.cameraFailed' });
      }
    }
    this.#refresh();
  }

  /**
   * Shares a screen or window picked in the app's picker (A14): up to 1080p, at the preset's
   * frame rate, H.264 like the camera (T8), optionally with the computer's sound.
   */
  async startScreenShare(sourceId: string): Promise<void> {
    const room = this.#room;
    if (!room || this.#screen) return;
    const { sharePreset: preset, shareAudio } = this.#state.settings;
    let stream: MediaStream;
    try {
      await window.hasbihal.screen.choose(sourceId, shareAudio);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
        audio: shareAudio
          ? // The computer's sound as it is, without our own playback (the others' voices),
            // which would otherwise echo back to them (ARCHITECTURE §6.2).
            ({
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              restrictOwnAudio: true,
            } as MediaTrackConstraints)
          : false,
      });
    } catch {
      this.#set({ notice: 'hangout.shareFailed' });
      return;
    }
    const [videoTrack] = stream.getVideoTracks();
    const [audioTrack] = stream.getAudioTracks();
    if (!videoTrack || this.#room !== room) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    // Electron's handler ignores getDisplayMedia's size hints, so the cap is applied here (S1).
    await videoTrack
      .applyConstraints({
        width: { max: 1920 },
        height: { max: 1080 },
        frameRate: { ideal: SHARE_ENCODING[preset].maxFramerate, max: 60 },
      })
      .catch(() => undefined);
    videoTrack.contentHint = preset === 'motion' ? 'motion' : 'detail';

    const video = new LocalVideoTrack(videoTrack, undefined, false);
    const audio = audioTrack ? new LocalAudioTrack(audioTrack, undefined, false) : null;
    this.#screen = { video, audio };
    // Sharing ends from outside too: the OS's own "stop sharing", or the window closing.
    videoTrack.addEventListener('ended', () => {
      if (this.#screen?.video === video) void this.stopScreenShare();
    });
    try {
      await room.localParticipant.publishTrack(video, {
        source: Track.Source.ScreenShare,
        simulcast: false,
        // LiveKit ignores videoEncoding for shares; its own default is 15 fps (S1).
        screenShareEncoding: SHARE_ENCODING[preset],
        degradationPreference: preset === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
      });
      if (audio)
        await room.localParticipant.publishTrack(audio, {
          source: Track.Source.ScreenShareAudio,
          audioPreset: AudioPresets.musicHighQualityStereo,
          forceStereo: true,
          dtx: false,
          red: false,
        });
      this.#set({ sharing: true, notice: null });
    } catch {
      await this.stopScreenShare();
      this.#set({ notice: 'hangout.shareFailed' });
    }
    this.#refresh();
  }

  async stopScreenShare(): Promise<void> {
    const room = this.#room;
    const screen = this.#screen;
    if (!screen) return;
    this.#screen = null;
    if (room) {
      await room.localParticipant.unpublishTrack(screen.video).catch(() => undefined);
      if (screen.audio)
        await room.localParticipant.unpublishTrack(screen.audio).catch(() => undefined);
    }
    screen.video.stop();
    screen.audio?.stop();
    this.#set({ sharing: false });
    this.#refresh();
  }

  /** Starts or stops watching someone's share; only watched shares are downloaded. */
  watch(userId: string, watching: boolean): void {
    if (watching) this.#watching.add(userId);
    else this.#watching.delete(userId);
    const participant = this.#room?.remoteParticipants.get(userId);
    if (participant) this.#syncSubscriptions(participant);
    this.#refresh();
  }

  setPushToTalk(held: boolean): void {
    this.#mic?.setPushToTalk(held);
  }

  updateSettings(change: Partial<VoiceSettings>): void {
    const settings = { ...this.#state.settings, ...change };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.#set({ settings });
    this.#mic?.update(settings);
    this.#testMic?.mic.update(settings);
    if (change.volumes) this.#applyVolumes();
    // A test hears the chosen microphone.
    if (change.deviceId !== undefined && this.#testMic) {
      this.stopMicTest();
      void this.startMicTest();
    }
    // A different microphone means reopening it.
    if (change.deviceId !== undefined && this.#room) void this.#reopenMic();
  }

  /** A person's voice volume by user id, or their share's sound by `screenVolumeKey`. */
  setVolume(key: string, volume: number): void {
    this.updateSettings({ volumes: { ...this.#state.settings.volumes, [key]: volume } });
  }

  async #openMic(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    try {
      const mic = await Microphone.open(this.#state.settings, () => {
        // T7: the machine can't keep up; carry on without noise suppression and say so.
        mic.dropNoiseSuppression();
        this.#set({ noiseSuppressionAvailable: false, notice: 'hangout.noiseSuppressionOverload' });
      });
      if (this.#room !== room) {
        mic.close();
        return;
      }
      this.#mic = mic;
      mic.setMuted(this.#state.micMuted);
      this.#micPublication = await room.localParticipant.publishTrack(
        new LocalAudioTrack(mic.track, undefined, false),
        {
          source: Track.Source.Microphone,
          // ARCHITECTURE §6.2: Opus at 64 kbps, redundancy against loss, no DTX (clipped word starts).
          audioPreset: { maxBitrate: 64_000 },
          dtx: false,
          red: true,
        },
      );
      if (this.#state.micMuted) await this.#micPublication.mute();
      this.#set({
        micUnavailable: false,
        noiseSuppressionAvailable: mic.noiseSuppressionAvailable,
      });
    } catch {
      this.#set({ micUnavailable: true, notice: 'hangout.micUnavailable' });
    }
  }

  async #reopenMic(): Promise<void> {
    const room = this.#room;
    if (this.#micPublication?.track && room)
      await room.localParticipant.unpublishTrack(this.#micPublication.track);
    this.#mic?.close();
    this.#mic = null;
    this.#micPublication = null;
    await this.#openMic();
    this.#refresh();
  }

  async #setMicMuted(muted: boolean): Promise<void> {
    this.#set({ micMuted: muted });
    this.#mic?.setMuted(muted);
    // Muting the publication too lets everyone see the muted icon.
    if (muted) await this.#micPublication?.mute();
    else await this.#micPublication?.unmute();
    this.#refresh();
  }

  #stopScreenTracks(): void {
    this.#screen?.video.stop();
    this.#screen?.audio?.stop();
    this.#screen = null;
  }

  /** Voices and cameras always; a share and its sound only while watched (A14). */
  #syncSubscriptions(participant: RemoteParticipant): void {
    const watching = this.#watching.has(participant.identity);
    for (const publication of participant.trackPublications.values()) {
      const isShare =
        publication.source === Track.Source.ScreenShare ||
        publication.source === Track.Source.ScreenShareAudio;
      const wanted = !isShare || watching;
      if (publication.isDesired !== wanted) publication.setSubscribed(wanted);
    }
  }

  #attachAudio(track: RemoteTrack, trackSid: string): void {
    const element = track.attach();
    element.hidden = true;
    document.body.append(element);
    this.#audioElements.set(trackSid, [...(this.#audioElements.get(trackSid) ?? []), element]);
    this.#applyVolumes();
  }

  #detachAudio(track: RemoteTrack, trackSid: string): void {
    for (const element of track.detach()) element.remove();
    this.#audioElements.delete(trackSid);
  }

  #applyVolumes(): void {
    const room = this.#room;
    if (!room) return;
    const { deafened, settings } = this.#state;
    for (const participant of room.remoteParticipants.values()) {
      const id = participant.identity;
      participant.setVolume(deafened ? 0 : (settings.volumes[id] ?? 1), Track.Source.Microphone);
      participant.setVolume(
        deafened ? 0 : (settings.volumes[screenVolumeKey(id)] ?? 1),
        Track.Source.ScreenShareAudio,
      );
    }
  }

  #refresh(): void {
    const room = this.#room;
    if (!room) return;
    const view = (p: Participant, isLocal: boolean): ParticipantView => {
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const camera = p.getTrackPublication(Track.Source.Camera);
      return {
        userId: p.identity,
        isLocal,
        speaking: this.#speakers.has(p.identity),
        micMuted: isLocal
          ? this.#state.micMuted || this.#state.micUnavailable
          : (mic?.isMuted ?? true),
        camera: camera && !camera.isMuted ? (camera.videoTrack ?? null) : null,
      };
    };
    const shares: ShareView[] = [];
    if (this.#screen)
      shares.push({
        userId: room.localParticipant.identity,
        isLocal: true,
        track: this.#screen.video,
        hasAudio: this.#screen.audio !== null,
        watching: true,
      });
    for (const p of room.remoteParticipants.values()) {
      const screen = p.getTrackPublication(Track.Source.ScreenShare);
      if (!screen) continue;
      const watching = this.#watching.has(p.identity);
      shares.push({
        userId: p.identity,
        isLocal: false,
        track: watching ? (screen.videoTrack ?? null) : null,
        hasAudio: p.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined,
        watching,
      });
    }
    this.#set({
      participants: [
        view(room.localParticipant, true),
        ...[...room.remoteParticipants.values()].map((p) => view(p, false)),
      ],
      shares,
    });
    this.#applyVolumes();
  }

  #startSpeakingCheck(): void {
    this.#stopSpeakingCheck();
    const detector = new SpeakingDetector();
    this.#speaking = {
      detector,
      timer: setInterval(() => {
        this.#checkSpeaking(detector);
      }, SPEAKING_CHECK_MS),
    };
  }

  #stopSpeakingCheck(): void {
    if (!this.#speaking) return;
    clearInterval(this.#speaking.timer);
    this.#speaking.detector.close();
    this.#speaking = null;
    this.#speakers = new Set();
  }

  /** Re-renders only when someone starts or stops speaking. */
  #checkSpeaking(detector: SpeakingDetector): void {
    const room = this.#room;
    if (!room) return;
    const now = performance.now();
    const ids = new Set<string>();
    const speakers = new Set<string>();
    const me = room.localParticipant.identity;
    ids.add(me);
    if (detector.speaking(me, now, this.#mic?.speaking ?? false)) speakers.add(me);
    for (const p of room.remoteParticipants.values()) {
      ids.add(p.identity);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      detector.watch(
        p.identity,
        mic && !mic.isMuted ? (mic.audioTrack?.mediaStreamTrack ?? null) : null,
      );
      if (detector.speaking(p.identity, now)) speakers.add(p.identity);
    }
    detector.keepOnly(ids);
    const changed =
      speakers.size !== this.#speakers.size || [...speakers].some((id) => !this.#speakers.has(id));
    if (!changed) return;
    this.#speakers = speakers;
    this.#refresh();
  }

  #set(change: Partial<HangoutState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
    const { notice } = change;
    if (notice) for (const listener of this.#noticeListeners) listener(notice);
  }
}

export type { InputMode };
