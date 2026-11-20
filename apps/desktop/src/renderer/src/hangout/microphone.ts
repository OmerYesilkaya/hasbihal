import {
  createDeepFilterNetAudioWorklet,
  DEEPFILTERNET_SAMPLE_RATE,
} from '@workadventure/noise-suppression/deepfilternet';

/** How the microphone opens: by voice (A37's default) or while a key is held. */
export type InputMode = 'voice' | 'ptt';

export interface MicSettings {
  deviceId: string | null;
  noiseSuppression: boolean;
  mode: InputMode;
  /** Voice activation opens above this level (dBFS); the sensitivity slider. */
  thresholdDb: number;
}

/** Voice activation stays open this long after the last loud moment, so word ends aren't cut. */
const HOLD_MS = 400;
const CHECK_EVERY_MS = 20;

const toDb = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -100);

/**
 * The microphone as published (ARCHITECTURE §6.2): echo cancellation from the browser, then
 * DeepFilterNet (T7) when enabled, then a gate opened by voice or by push-to-talk. The level
 * meter reads before the gate, so it can tell speech while the gate is closed.
 */
export class Microphone {
  readonly #context: AudioContext;
  readonly #input: MediaStream;
  readonly #raw: GainNode;
  readonly #clean: GainNode | null;
  readonly #gate: GainNode;
  readonly #analyser: AnalyserNode;
  readonly #samples: Float32Array<ArrayBuffer>;
  readonly #timer: ReturnType<typeof setInterval>;
  readonly #dispose: () => void;
  #settings: MicSettings;
  #muted = false;
  #pttHeld = false;
  #lastLoud = 0;
  #levelDb = -100;
  #open = false;
  /** The processed track to publish. */
  readonly track: MediaStreamTrack;
  /** DeepFilterNet is available on this machine (it loaded and keeps up). */
  noiseSuppressionAvailable: boolean;

  private constructor(parts: {
    context: AudioContext;
    input: MediaStream;
    raw: GainNode;
    clean: GainNode | null;
    gate: GainNode;
    analyser: AnalyserNode;
    track: MediaStreamTrack;
    dispose: () => void;
    settings: MicSettings;
  }) {
    this.#context = parts.context;
    this.#input = parts.input;
    this.#raw = parts.raw;
    this.#clean = parts.clean;
    this.#gate = parts.gate;
    this.#analyser = parts.analyser;
    this.#samples = new Float32Array(parts.analyser.fftSize);
    this.track = parts.track;
    this.#dispose = parts.dispose;
    this.#settings = parts.settings;
    this.noiseSuppressionAvailable = parts.clean !== null;
    this.#route();
    this.#timer = setInterval(() => {
      this.#tick();
    }, CHECK_EVERY_MS);
  }

  /** Opens the microphone. Rejects when there is none or permission is refused. */
  static async open(settings: MicSettings, onOverload: () => void): Promise<Microphone> {
    const input = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        // DeepFilterNet does this far better; two suppressors in a row only damage the voice.
        noiseSuppression: false,
        autoGainControl: true,
      },
    });
    const context = new AudioContext({
      sampleRate: DEEPFILTERNET_SAMPLE_RATE,
      latencyHint: 'interactive',
    });
    const source = context.createMediaStreamSource(input);
    const mix = context.createGain();
    const raw = context.createGain();
    source.connect(raw).connect(mix);

    // Both paths stay connected; switching is a gain change, so toggling is instant mid-call.
    let clean: GainNode | null = null;
    let dispose: () => void = () => {
      // nothing loaded yet
    };
    try {
      const filter = await createDeepFilterNetAudioWorklet(context, {
        onOverload: () => {
          onOverload();
        },
      });
      await filter.ready;
      clean = context.createGain();
      source.connect(filter.node).connect(clean).connect(mix);
      dispose = () => {
        filter.dispose();
      };
    } catch {
      // Not available here (no Wasm, failed load): the raw path still works.
    }

    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const gate = context.createGain();
    const output = context.createMediaStreamDestination();
    mix.connect(analyser);
    mix.connect(gate).connect(output);
    const [track] = output.stream.getAudioTracks();
    if (!track) throw new Error('no processed audio track');
    return new Microphone({ context, input, raw, clean, gate, analyser, track, dispose, settings });
  }

  /**
   * Speaking as others hear it: the gate is open (not muted; voice, or the push-to-talk key) and
   * the voice is above the sensitivity line. Drives one's own speaking ring (#35).
   */
  get speaking(): boolean {
    return this.#open && this.#levelDb >= this.#settings.thresholdDb;
  }

  /** The level before the gate, in dBFS: for the sensitivity meter. */
  get levelDb(): number {
    return this.#levelDb;
  }

  update(settings: Partial<MicSettings>): void {
    this.#settings = { ...this.#settings, ...settings };
    this.#route();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#tick();
  }

  setPushToTalk(held: boolean): void {
    this.#pttHeld = held;
    this.#tick();
  }

  /** DeepFilterNet couldn't keep up on this machine (T7): carry on without it. */
  dropNoiseSuppression(): void {
    this.noiseSuppressionAvailable = false;
    this.#route();
  }

  close(): void {
    clearInterval(this.#timer);
    this.#dispose();
    for (const t of this.#input.getTracks()) t.stop();
    this.track.stop();
    void this.#context.close();
  }

  #route(): void {
    const filtered =
      this.#settings.noiseSuppression && this.noiseSuppressionAvailable && this.#clean !== null;
    this.#raw.gain.value = filtered ? 0 : 1;
    if (this.#clean) this.#clean.gain.value = filtered ? 1 : 0;
  }

  #tick(): void {
    this.#analyser.getFloatTimeDomainData(this.#samples);
    let sum = 0;
    for (const s of this.#samples) sum += s * s;
    this.#levelDb = toDb(Math.sqrt(sum / this.#samples.length));
    const now = performance.now();
    if (this.#levelDb >= this.#settings.thresholdDb) this.#lastLoud = now;
    const open =
      !this.#muted &&
      (this.#settings.mode === 'ptt' ? this.#pttHeld : now - this.#lastLoud < HOLD_MS);
    this.#open = open;
    // A short ramp instead of a jump: no clicks when the gate moves.
    this.#gate.gain.setTargetAtTime(open ? 1 : 0, this.#context.currentTime, 0.01);
  }
}
