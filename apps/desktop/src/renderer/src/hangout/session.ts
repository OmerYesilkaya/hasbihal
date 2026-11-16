import {
  ConnectionState,
  createLocalVideoTrack,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  type VideoTrack,
} from 'livekit-client';
import type { MessageKey } from '@hasbihal/core';
import { HangoutToken } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Microphone, type InputMode, type MicSettings } from './microphone.ts';

/** One person in the call, as the grid shows them. */
export interface ParticipantView {
  userId: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  camera: VideoTrack | null;
}

export interface VoiceSettings extends MicSettings {
  cameraId: string | null;
  /** `KeyboardEvent.code` held for push-to-talk while the app is focused. */
  pttKey: string;
  /** Per-person volume, 0–2 (A29), by user id. */
  volumes: Record<string, number>;
}

export interface HangoutState {
  roomId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  micMuted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  /** The mic couldn't be opened (no device, permission refused): listening only. */
  micUnavailable: boolean;
  noiseSuppressionAvailable: boolean;
  participants: ParticipantView[];
  settings: VoiceSettings;
  /** Something the user should know, e.g. "noise suppression was switched off". */
  notice: MessageKey | null;
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
    micUnavailable: false,
    noiseSuppressionAvailable: true,
    participants: [],
    settings: loadSettings(),
    notice: null,
  };
  readonly #listeners = new Set<() => void>();
  readonly #serverUrl: string;
  #room: Room | null = null;
  #mic: Microphone | null = null;
  #micPublication: LocalTrackPublication | null = null;
  #camera: LocalVideoTrack | null = null;
  readonly #audioElements = new Map<string, HTMLMediaElement[]>();

  constructor(serverUrl: string) {
    this.#serverUrl = serverUrl;
  }

  getSnapshot = (): HangoutState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The microphone's level before the gate, for the sensitivity meter. */
  micLevelDb(): number {
    return this.#mic?.levelDb ?? -100;
  }

  async join(roomId: string): Promise<void> {
    if (this.#state.roomId === roomId) return;
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
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) this.#attachAudio(track, participant.identity);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) this.#detachAudio(track, participant.identity);
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
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
      await room.connect(token.value.url, token.value.token);
    } catch {
      this.#room = null;
      this.#set({ roomId: null, status: 'idle', notice: 'hangout.joinFailed' });
      return;
    }
    if (this.#room !== room) return; // left while connecting
    this.#set({ status: 'connected' });
    this.#refresh(); // show the call at once; the mic can take a moment to load
    await this.#openMic();
    this.#refresh();
  }

  async leave(): Promise<void> {
    const room = this.#room;
    this.#room = null;
    this.#mic?.close();
    this.#mic = null;
    this.#micPublication = null;
    this.#camera?.stop();
    this.#camera = null;
    for (const elements of this.#audioElements.values()) for (const el of elements) el.remove();
    this.#audioElements.clear();
    if (room) await room.disconnect();
    this.#set({ roomId: null, status: 'idle', cameraOn: false, participants: [] });
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

  setPushToTalk(held: boolean): void {
    this.#mic?.setPushToTalk(held);
  }

  updateSettings(change: Partial<VoiceSettings>): void {
    const settings = { ...this.#state.settings, ...change };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.#set({ settings });
    this.#mic?.update(settings);
    if (change.volumes) this.#applyVolumes();
    // A different microphone means reopening it.
    if (change.deviceId !== undefined && this.#room) void this.#reopenMic();
  }

  setVolume(userId: string, volume: number): void {
    this.updateSettings({ volumes: { ...this.#state.settings.volumes, [userId]: volume } });
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

  #attachAudio(track: RemoteTrack, userId: string): void {
    const element = track.attach();
    element.hidden = true;
    document.body.append(element);
    this.#audioElements.set(userId, [...(this.#audioElements.get(userId) ?? []), element]);
    this.#applyVolumes();
  }

  #detachAudio(track: RemoteTrack, userId: string): void {
    for (const element of track.detach()) element.remove();
    this.#audioElements.delete(userId);
  }

  #applyVolumes(): void {
    const room = this.#room;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      const volume = this.#state.deafened
        ? 0
        : (this.#state.settings.volumes[participant.identity] ?? 1);
      participant.setVolume(volume);
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
        speaking: p.isSpeaking,
        micMuted: isLocal
          ? this.#state.micMuted || this.#state.micUnavailable
          : (mic?.isMuted ?? true),
        camera: camera && !camera.isMuted ? (camera.videoTrack ?? null) : null,
      };
    };
    this.#set({
      participants: [
        view(room.localParticipant, true),
        ...[...room.remoteParticipants.values()].map((p) => view(p, false)),
      ],
    });
    this.#applyVolumes();
  }

  #set(change: Partial<HangoutState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
  }
}

export type { InputMode };
