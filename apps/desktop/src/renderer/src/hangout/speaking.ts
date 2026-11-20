/** How often levels are read: fast enough that the ring feels instant. */
export const SPEAKING_CHECK_MS = 50;
/** Stays "speaking" this long after the last loud moment, so the ring doesn't flicker. */
const HOLD_MS = 300;
/**
 * Above this level (dBFS) a received voice counts as speaking. Senders already gate their
 * microphone (voice activation or push-to-talk), so between words the track is near silence.
 */
const THRESHOLD_DB = -50;

interface Source {
  track: MediaStreamTrack;
  node: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
}

/**
 * Who is speaking, worked out here from the audio itself (#35). LiveKit's active speakers come
 * from the server in intervals, so a ring driven by them showed up half a second or more late.
 */
export class SpeakingDetector {
  readonly #context = new AudioContext();
  readonly #sources = new Map<string, Source>();
  readonly #lastLoud = new Map<string, number>();

  /** Follows one person's received microphone track; null stops following it. */
  watch(id: string, track: MediaStreamTrack | null): void {
    const current = this.#sources.get(id);
    if (current?.track === track) return;
    if (current) {
      current.node.disconnect();
      this.#sources.delete(id);
    }
    if (!track) return;
    const node = this.#context.createMediaStreamSource(new MediaStream([track]));
    const analyser = this.#context.createAnalyser();
    analyser.fftSize = 512;
    node.connect(analyser);
    this.#sources.set(id, { track, node, analyser, samples: new Float32Array(analyser.fftSize) });
  }

  /** Stops following everyone not in `ids`. */
  keepOnly(ids: Set<string>): void {
    for (const id of this.#sources.keys()) if (!ids.has(id)) this.watch(id, null);
    for (const id of this.#lastLoud.keys()) if (!ids.has(id)) this.#lastLoud.delete(id);
  }

  /** Whether `id` is speaking now; `localLoud` overrides the level for oneself. */
  speaking(id: string, now: number, localLoud?: boolean): boolean {
    const loud = localLoud ?? this.#loud(id);
    if (loud) this.#lastLoud.set(id, now);
    return now - (this.#lastLoud.get(id) ?? -Infinity) < HOLD_MS;
  }

  close(): void {
    for (const id of [...this.#sources.keys()]) this.watch(id, null);
    void this.#context.close();
  }

  #loud(id: string): boolean {
    const source = this.#sources.get(id);
    if (!source) return false;
    source.analyser.getFloatTimeDomainData(source.samples);
    let sum = 0;
    for (const s of source.samples) sum += s * s;
    const rms = Math.sqrt(sum / source.samples.length);
    return rms > 0 && 20 * Math.log10(rms) >= THRESHOLD_DB;
  }
}
