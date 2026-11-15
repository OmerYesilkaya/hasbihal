// Throwaway spike UI for S1 (screen share + system audio) and S2 (DeepFilterNet).
// Deliberately plain DOM code: none of this is product code.
import { createNoiseSuppressionAudioWorklet } from '@workadventure/noise-suppression/audio-worklet';
import { createDeepFilterNetAudioWorklet, DEEPFILTERNET_SAMPLE_RATE, type LoadReport } from '@workadventure/noise-suppression/deepfilternet';
import {
  AudioPresets,
  LocalTrackPublication,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type VideoCodec,
} from 'livekit-client';

declare global {
  interface Window {
    spike: {
      token(identity: string): Promise<string>;
      metrics(): Promise<{ type: string; pid: number; cpu: number }[]>;
      info(): Promise<Record<string, unknown>>;
      autoResult(result: unknown): Promise<void>;
      readInput(name: 'speech' | 'tv'): Promise<ArrayBuffer | undefined>;
      saveOutput(name: string, data: Uint8Array): Promise<void>;
    };
  }
}

const LIVEKIT_URL = 'ws://localhost:7880';
const role = new URLSearchParams(location.search).get('role') ?? 'publisher';
const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = app) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

function meter(label: string): (rms: number) => void {
  const wrap = el('div');
  el('span', label, wrap);
  const bar = el('div', '', wrap);
  bar.className = 'meter';
  const fill = el('div', '', bar);
  const value = el('span', '', wrap);
  return (rms) => {
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    fill.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    value.textContent = `${db.toFixed(1)} dBFS`;
  };
}

/** Feeds a track's RMS level to `onLevel` ~10x per second. */
function watchLevel(track: MediaStreamTrack, onLevel: (rms: number) => void): () => void {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const s of buf) sum += s * s;
    onLevel(Math.sqrt(sum / buf.length));
  }, 100);
  return () => {
    clearInterval(timer);
    void ctx.close();
  };
}

function log(pre: HTMLElement, line: string): void {
  pre.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${pre.textContent ?? ''}`.slice(0, 6000);
}

// Previous byte counters per stats id, to turn cumulative counters into a bitrate.
const prevBytes = new Map<string, { bytes: number; ts: number }>();

function rateMbps(id: string, bytes: unknown, ts: unknown): string {
  const b = Number(bytes);
  const t = Number(ts);
  const prev = prevBytes.get(id);
  prevBytes.set(id, { bytes: b, ts: t });
  if (!prev || t <= prev.ts) return '?';
  return (((b - prev.bytes) * 8) / ((t - prev.ts) / 1000) / 1e6).toFixed(1);
}

async function statsLine(track: { getRTCStatsReport(): Promise<RTCStatsReport | undefined> }, kind: 'inbound-rtp' | 'outbound-rtp') {
  const report = await track.getRTCStatsReport();
  const parts: string[] = [];
  report?.forEach((s: Record<string, unknown>) => {
    if (s.type === 'candidate-pair' && s.nominated && s.availableOutgoingBitrate) {
      parts.push(`available out=${(Number(s.availableOutgoingBitrate) / 1e6).toFixed(1)} Mbps rtt=${String(s.currentRoundTripTime)}`);
    }
    // Frames the encoder is fed. If this is 60 but the sent fps is lower, the encoder drops frames.
    if (s.type === 'media-source' && s.kind === 'video') {
      parts.push(`encoder input ${String(s.width)}x${String(s.height)} @ ${String(s.framesPerSecond ?? '?')} fps`);
    }
    if (s.type !== kind) return;
    if (s.kind === 'video') {
      const bytes = kind === 'outbound-rtp' ? s.bytesSent : s.bytesReceived;
      const encMs =
        s.framesEncoded && s.totalEncodeTime ? ((Number(s.totalEncodeTime) / Number(s.framesEncoded)) * 1000).toFixed(1) : undefined;
      parts.push(
        `video ${String(s.frameWidth)}x${String(s.frameHeight)} @ ${String(s.framesPerSecond ?? '?')} fps` +
          ` ${rateMbps(String(s.id), bytes, s.timestamp)} Mbps` +
          (s.targetBitrate ? ` target=${(Number(s.targetBitrate) / 1e6).toFixed(1)} Mbps` : '') +
          (s.qualityLimitationReason ? ` limit=${String(s.qualityLimitationReason)}` : '') +
          (s.encoderImplementation ? ` enc=${String(s.encoderImplementation)}` : '') +
          (s.powerEfficientEncoder !== undefined ? ` hw=${String(s.powerEfficientEncoder)}` : '') +
          (encMs ? ` encode=${encMs} ms/frame` : '') +
          (s.decoderImplementation ? ` dec=${String(s.decoderImplementation)}` : '') +
          (s.powerEfficientDecoder !== undefined ? ` hw=${String(s.powerEfficientDecoder)}` : '') +
          (s.framesDropped !== undefined ? ` dropped=${String(s.framesDropped)}` : ''),
      );
    } else if (s.kind === 'audio') {
      parts.push(`audio packets=${String(s.packetsSent ?? s.packetsReceived)} jitter=${String(s.jitter ?? '-')}`);
    }
  });
  return parts.join(' | ');
}

async function header(): Promise<void> {
  el('h1', `Hasbihal media spike: ${role}`);
  el('pre', JSON.stringify(await window.spike.info()));
  const cpu = el('pre', 'CPU: …');
  setInterval(() => {
    void window.spike.metrics().then((list) => {
      cpu.textContent =
        'CPU % by process: ' +
        list.map((m) => `${m.type}#${m.pid}=${m.cpu.toFixed(1)}`).join('  ') +
        `  total=${list.reduce((a, m) => a + m.cpu, 0).toFixed(1)}`;
    });
  }, 1000);
}

async function connect(identity: string): Promise<Room> {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  await room.connect(LIVEKIT_URL, await window.spike.token(identity));
  return room;
}

// ---------------------------------------------------------------- publisher

async function publisher(): Promise<void> {
  await header();
  const out = el('pre', '');
  let room: Room | undefined;
  const ensureRoom = async () => (room ??= await connect(`publisher-${Date.now()}`));

  // S1 --------------------------------------------------------------------
  el('h2', 'S1: screen share with system audio');
  const codec = el('select') as HTMLSelectElement;
  for (const c of ['h264', 'vp9', 'vp8', 'av1']) codec.append(new Option(c, c));
  const restrictLabel = el('label');
  const restrictBox = el('input', '', restrictLabel) as HTMLInputElement;
  restrictBox.type = 'checkbox';
  restrictBox.checked = true;
  restrictLabel.append(' restrictOwnAudio (exclude this window\'s own sound)');
  const hint = el('select') as HTMLSelectElement;
  for (const h of ['motion', 'detail']) hint.append(new Option(`contentHint=${h}`, h));
  const shareBtn = el('button', 'Capture screen + system audio');
  const toneBtn = el('button', 'Play test tone in THIS window');
  const publishBtn = el('button', 'Publish to LiveKit');
  publishBtn.disabled = true;
  const unpublishBtn = el('button', 'Unpublish (to switch codec)');
  unpublishBtn.disabled = true;
  // Hardware-encoding experiment: same codec, but a canvas instead of a screen capture.
  const patternSize = el('select') as HTMLSelectElement;
  for (const s of ['1280x720', '1920x1080', '1660x1078']) patternSize.append(new Option(`pattern ${s}`, s));
  const patternBtn = el('button', 'Publish test pattern (canvas, not screen)');
  const capInfo = el('pre', '');
  const preview = el('video') as HTMLVideoElement;
  preview.muted = true;
  preview.autoplay = true;
  preview.style.maxHeight = '160px';
  const captureFps = el('pre', 'Measured capture fps: -');
  let tone: { ctx: AudioContext; osc: OscillatorNode } | undefined;
  toneBtn.onclick = () => {
    if (tone) {
      tone.osc.stop();
      void tone.ctx.close();
      tone = undefined;
      toneBtn.textContent = 'Play test tone in THIS window';
      return;
    }
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    tone = { ctx, osc };
    toneBtn.textContent = 'Stop test tone';
  };
  const sysLevel = meter('Captured system audio: ');
  const pubStats = el('pre', '');
  let screen: MediaStream | undefined;
  const pubs: LocalTrackPublication[] = [];
  let statsTimer: ReturnType<typeof setInterval> | undefined;

  shareBtn.onclick = async () => {
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          restrictOwnAudio: restrictBox.checked,
        } as MediaTrackConstraints,
      });
      const [v] = screen.getVideoTracks();
      const [a] = screen.getAudioTracks();
      const before = JSON.stringify(v?.getSettings());
      // The request handler ignores getDisplayMedia's size hints, so cap the size explicitly.
      await v?.applyConstraints({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 60, max: 60 } });
      log(out, `video settings before constraints: ${before}`);
      preview.srcObject = new MediaStream(v ? [v] : []);
      let frames = 0;
      const count = () => {
        frames++;
        preview.requestVideoFrameCallback(count);
      };
      preview.requestVideoFrameCallback(count);
      setInterval(() => {
        captureFps.textContent = `Measured capture fps: ${frames}  (frames only arrive when the screen changes; play a full-screen video)`;
        frames = 0;
      }, 1000);
      capInfo.textContent =
        `restrictOwnAudio requested=${restrictBox.checked} supported=${String(navigator.mediaDevices.getSupportedConstraints()['restrictOwnAudio' as keyof MediaTrackSupportedConstraints])}\n` +
        `video: ${JSON.stringify(v?.getSettings())}\n` +
        (a ? `audio: label="${a.label}" settings=${JSON.stringify(a.getSettings())} muted=${a.muted}` : 'audio: NONE (no audio track returned)');
      if (a) watchLevel(a, sysLevel);
      publishBtn.disabled = false;
      log(out, 'capture started');
    } catch (e) {
      log(out, `capture failed: ${String(e)}`);
    }
  };

  publishBtn.onclick = async () => {
    if (!screen) return;
    const r = await ensureRoom();
    const [v] = screen.getVideoTracks();
    const [a] = screen.getAudioTracks();
    if (v) {
      v.contentHint = hint.value;
      pubs.push(
        await r.localParticipant.publishTrack(v, {
          source: Track.Source.ScreenShare,
          videoCodec: codec.value as VideoCodec,
          backupCodec: false,
          simulcast: false,
          // For ScreenShare sources LiveKit ignores `videoEncoding` and uses `screenShareEncoding`,
          // which defaults to 1080p at 15 fps and 2.5 Mbps. Run 2 hit exactly that cap.
          screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
          degradationPreference: hint.value === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
        }),
      );
    }
    if (a) {
      pubs.push(
        await r.localParticipant.publishTrack(a, {
          source: Track.Source.ScreenShareAudio,
          audioPreset: AudioPresets.musicHighQualityStereo,
          forceStereo: true,
          dtx: false,
          red: false,
        }),
      );
    }
    log(out, `published ${pubs.length} track(s) with ${codec.value}, contentHint=${hint.value}`);
    publishBtn.disabled = true;
    patternBtn.disabled = true;
    unpublishBtn.disabled = false;
    statsTimer = setInterval(() => {
      void Promise.all(pubs.map((p) => (p.track ? statsLine(p.track, 'outbound-rtp') : ''))).then((lines) => {
        pubStats.textContent = 'Outbound: ' + lines.filter(Boolean).join(' | ');
      });
    }, 1000);
  };

  let pattern: { stop(): void } | undefined;
  patternBtn.onclick = async () => {
    const r = await ensureRoom();
    const [w, h] = patternSize.value.split('x').map(Number) as [number, number];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let raf = 0;
    const draw = () => {
      // Moving gradient plus noise-like stripes, so the encoder has real work every frame.
      const g = ctx.createLinearGradient((frame * 7) % w, 0, w - ((frame * 5) % w), h);
      g.addColorStop(0, `hsl(${frame % 360} 70% 50%)`);
      g.addColorStop(1, `hsl(${(frame + 180) % 360} 70% 40%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `hsl(${(i * 37 + frame * 3) % 360} 80% 60%)`;
        ctx.fillRect(((i * 97 + frame * 11) % w), (i * 53) % h, 60, 60);
      }
      ctx.fillStyle = '#fff';
      ctx.font = '64px sans-serif';
      ctx.fillText(`frame ${frame}`, 40, 100);
      frame++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    const [track] = canvas.captureStream(60).getVideoTracks();
    if (!track) return;
    track.contentHint = 'motion';
    pubs.push(
      await r.localParticipant.publishTrack(track, {
        source: Track.Source.Camera,
        videoCodec: codec.value as VideoCodec,
        backupCodec: false,
        simulcast: false,
        videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
        degradationPreference: 'maintain-framerate',
      }),
    );
    pattern = {
      stop() {
        cancelAnimationFrame(raf);
        track.stop();
      },
    };
    log(out, `published test pattern ${patternSize.value} with ${codec.value}`);
    publishBtn.disabled = true;
    patternBtn.disabled = true;
    unpublishBtn.disabled = false;
    statsTimer = setInterval(() => {
      void Promise.all(pubs.map((p) => (p.track ? statsLine(p.track, 'outbound-rtp') : ''))).then((lines) => {
        pubStats.textContent = 'Outbound: ' + lines.filter(Boolean).join(' | ');
      });
    }, 1000);
  };

  // Keeps the capture running, so another codec can be published without a new capture.
  unpublishBtn.onclick = async () => {
    clearInterval(statsTimer);
    const r = await ensureRoom();
    for (const p of pubs.splice(0)) {
      if (p.track) await r.localParticipant.unpublishTrack(p.track, false);
    }
    pattern?.stop();
    pattern = undefined;
    pubStats.textContent = '';
    log(out, 'unpublished; pick another codec and publish again');
    publishBtn.disabled = !screen;
    patternBtn.disabled = false;
    unpublishBtn.disabled = true;
  };

  // S2 --------------------------------------------------------------------
  el('h2', 'S2: DeepFilterNet3 on the microphone');
  const micBtn = el('button', 'Start microphone');
  const dfnToggle = el('label');
  const dfnBox = el('input', '', dfnToggle) as HTMLInputElement;
  dfnBox.type = 'checkbox';
  dfnBox.checked = true;
  dfnToggle.append(' DeepFilterNet3 on (publishes the processed mic)');
  const monitorToggle = el('label');
  const monitorBox = el('input', '', monitorToggle) as HTMLInputElement;
  monitorBox.type = 'checkbox';
  monitorToggle.append(' Monitor processed mic locally (use headphones)');
  const rawLevel = meter('Raw mic: ');
  const cleanLevel = meter('After DeepFilterNet: ');
  const dfnInfo = el('pre', '');

  micBtn.onclick = async () => {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
    const [micTrack] = mic.getAudioTracks();
    if (!micTrack) return;
    watchLevel(micTrack, rawLevel);

    const ctx = new AudioContext({ sampleRate: DEEPFILTERNET_SAMPLE_RATE, latencyHint: 'interactive' });
    await ctx.resume();
    const source = ctx.createMediaStreamSource(mic);
    const dest = ctx.createMediaStreamDestination();
    const t0 = performance.now();
    const worklet = await createDeepFilterNetAudioWorklet(ctx, {
      loadReportAfterMs: 20_000,
      onLoadReport: (r) => log(dfnInfo, `load report (20 s): ${JSON.stringify(r)}`),
      onOverload: (load) => log(dfnInfo, `OVERLOAD: model used ${(load * 100).toFixed(0)}% of real time`),
    });
    const frame = await worklet.ready;
    log(dfnInfo, `DeepFilterNet ready in ${(performance.now() - t0).toFixed(0)} ms, frame=${JSON.stringify(frame)}, baseLatency=${(ctx.baseLatency * 1000).toFixed(1)} ms`);

    // Two paths: raw passthrough and denoised, switched with gains so toggling is instant.
    const rawGain = ctx.createGain();
    const cleanGain = ctx.createGain();
    source.connect(worklet.node).connect(cleanGain).connect(dest);
    source.connect(rawGain).connect(dest);
    const applyToggle = () => {
      cleanGain.gain.value = dfnBox.checked ? 1 : 0;
      rawGain.gain.value = dfnBox.checked ? 0 : 1;
    };
    dfnBox.onchange = applyToggle;
    applyToggle();

    const monitorGain = ctx.createGain();
    dest.stream.getAudioTracks()[0] && ctx.createMediaStreamSource(dest.stream).connect(monitorGain).connect(ctx.destination);
    const applyMonitor = () => (monitorGain.gain.value = monitorBox.checked ? 1 : 0);
    monitorBox.onchange = applyMonitor;
    applyMonitor();

    const [processed] = dest.stream.getAudioTracks();
    if (processed) {
      watchLevel(processed, cleanLevel);
      const r = await ensureRoom();
      await r.localParticipant.publishTrack(processed, {
        source: Track.Source.Microphone,
        audioPreset: { maxBitrate: 64_000 },
        dtx: false,
        red: true,
      });
      log(dfnInfo, 'published processed microphone (Opus 64 kbps, RED on, DTX off)');
    }
  };
}

// ------------------------------------------------------------------- viewer

async function viewer(): Promise<void> {
  await header();
  const out = el('pre', '');
  const playToggle = el('label');
  const playBox = el('input', '', playToggle) as HTMLInputElement;
  playBox.type = 'checkbox';
  playBox.checked = false;
  playToggle.append(' Play received audio (recapture/echo test)');
  const video = el('video') as HTMLVideoElement;
  video.autoplay = true;
  video.muted = true;
  const screenLevel = meter('Received screen audio: ');
  const micLevel = meter('Received microphone: ');
  const stats = el('pre', '');
  const audioEls: HTMLMediaElement[] = [];
  playBox.onchange = () => audioEls.forEach((a) => (a.muted = !playBox.checked));

  const room = await connect(`viewer-${Date.now()}`);
  log(out, 'connected as viewer; waiting for tracks');
  const remote: RemoteTrack[] = [];

  room.on(RoomEvent.TrackSubscribed, (track, publication) => {
    remote.push(track);
    log(out, `subscribed ${publication.source} (${track.kind})`);
    if (track.kind === Track.Kind.Video) {
      track.attach(video);
    } else {
      const audio = track.attach();
      audio.muted = !playBox.checked;
      audioEls.push(audio);
      const level = publication.source === Track.Source.ScreenShareAudio ? screenLevel : micLevel;
      if (track.mediaStreamTrack) watchLevel(track.mediaStreamTrack, level);
    }
  });

  setInterval(() => {
    void Promise.all(remote.map((t) => statsLine(t, 'inbound-rtp'))).then((lines) => {
      stats.textContent = 'Inbound: ' + lines.filter(Boolean).join(' | ');
    });
  }, 1000);
}

// ---------------------------------------------------------------- auto

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Draws a busy animation on `canvas` every frame until the returned function is called. */
function animate(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  let frame = 0;
  let raf = 0;
  const draw = () => {
    const g = ctx.createLinearGradient((frame * 7) % w, 0, w - ((frame * 5) % w), h);
    g.addColorStop(0, `hsl(${frame % 360} 70% 50%)`);
    g.addColorStop(1, `hsl(${(frame + 180) % 360} 70% 40%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `hsl(${(i * 37 + frame * 3) % 360} 80% 60%)`;
      ctx.fillRect((i * 97 + frame * 11) % w, (i * 53) % h, 60, 60);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '64px sans-serif';
    ctx.fillText(`frame ${frame}`, 40, 100);
    frame++;
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}

/** Averages an audio track's RMS level (dBFS) over `ms`. */
async function averageLevel(track: MediaStreamTrack, ms: number): Promise<number> {
  const samples: number[] = [];
  const stop = watchLevel(track, (rms) => samples.push(rms));
  await sleep(ms);
  stop();
  const rms = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

async function playTone(ms: number): Promise<void> {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  gain.gain.value = 0.2;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  await sleep(ms);
  osc.stop();
  await ctx.close();
}

async function captureScreen(restrictOwnAudio: boolean): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: 1920, height: 1080, frameRate: 60 },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio } as MediaTrackConstraints,
  });
  await stream.getVideoTracks()[0]?.applyConstraints({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 60, max: 60 } });
  return stream;
}

type Sample = Record<string, number | string | boolean | undefined>;

/** One second of outbound video stats, as numbers where possible. */
async function sampleVideo(track: { getRTCStatsReport(): Promise<RTCStatsReport | undefined> }, prev: Map<string, Sample>) {
  const report = await track.getRTCStatsReport();
  const out: Sample = {};
  const codecs = new Map<string, Record<string, unknown>>();
  report?.forEach((s: Record<string, unknown>) => {
    if (s.type === 'codec') codecs.set(String(s.id), s);
  });
  report?.forEach((s: Record<string, unknown>) => {
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      const c = codecs.get(String(s.codecId));
      out.negotiated = c ? `${String(c.mimeType)} ${String(c.sdpFmtpLine ?? '')}` : undefined;
    }
    if (s.type === 'candidate-pair' && s.nominated && s.availableOutgoingBitrate) out.availableMbps = Number(s.availableOutgoingBitrate) / 1e6;
    if (s.type === 'media-source' && s.kind === 'video') out.inputFps = Number(s.framesPerSecond ?? 0);
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      const p = prev.get(String(s.id));
      prev.set(String(s.id), s as Sample);
      out.width = Number(s.frameWidth);
      out.height = Number(s.frameHeight);
      out.sentFps = Number(s.framesPerSecond ?? 0);
      out.encoder = String(s.encoderImplementation);
      out.hw = s.powerEfficientEncoder as boolean | undefined;
      out.limit = String(s.qualityLimitationReason);
      out.targetMbps = Number(s.targetBitrate ?? 0) / 1e6;
      if (p) {
        const dt = (Number(s.timestamp) - Number(p.timestamp)) / 1000;
        out.sentMbps = ((Number(s.bytesSent) - Number(p.bytesSent)) * 8) / dt / 1e6;
        const frames = Number(s.framesEncoded) - Number(p.framesEncoded);
        out.encodeMsPerFrame = frames > 0 ? ((Number(s.totalEncodeTime) - Number(p.totalEncodeTime)) / frames) * 1000 : undefined;
      }
    }
  });
  const metrics = await window.spike.metrics();
  out.cpuTotal = metrics.reduce((a, m) => a + m.cpu, 0);
  return out;
}

/** What the subscriber receives: fps, size, decoder, and the negotiated codec. */
async function sampleInbound(track: RemoteTrack): Promise<Sample> {
  const report = await track.getRTCStatsReport();
  const out: Sample = {};
  const codecs = new Map<string, Record<string, unknown>>();
  report?.forEach((s: Record<string, unknown>) => {
    if (s.type === 'codec') codecs.set(String(s.id), s);
  });
  report?.forEach((s: Record<string, unknown>) => {
    if (s.type !== 'inbound-rtp' || s.kind !== 'video') return;
    const c = codecs.get(String(s.codecId));
    out.rxNegotiated = c ? `${String(c.mimeType)} ${String(c.sdpFmtpLine ?? '')}` : undefined;
    out.rxSize = `${String(s.frameWidth)}x${String(s.frameHeight)}`;
    out.rxFps = Number(s.framesPerSecond ?? 0);
    out.rxDecoder = String(s.decoderImplementation);
    out.rxHw = s.powerEfficientDecoder as boolean | undefined;
  });
  return out;
}

/** Medians of the numeric fields, and the last value of the text fields. */
function summarize(samples: Sample[]): Sample {
  const result: Sample = {};
  const keys = new Set(samples.flatMap((s) => Object.keys(s)));
  for (const k of keys) {
    const values = samples.map((s) => s[k]).filter((v) => v !== undefined);
    if (values.every((v) => typeof v === 'number')) {
      const sorted = (values as number[]).sort((a, b) => a - b);
      result[k] = Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10;
    } else {
      result[k] = values.at(-1);
    }
  }
  return result;
}

/**
 * Which encoder Chromium picks for each H.264/H.265 variant it offers, over a local
 * peer connection (no LiveKit), plus what WebCodecs says the hardware supports.
 */
async function probeEncoders(): Promise<Record<string, unknown>> {
  // Chrome only exposes encoderImplementation/powerEfficientEncoder to pages that capture media.
  const unlock = await captureScreen(true);
  const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
  // Every real codec variant; rtx/red/ulpfec/flexfec are not encoders.
  const variants = caps.filter((c) => !/rtx|red|ulpfec|flexfec/i.test(c.mimeType));
  const webrtc: Record<string, unknown>[] = [];
  for (const codec of variants) {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const stop = animate(c);
    const track = c.captureStream(60).getVideoTracks()[0]!;
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = (e) => e.candidate && void b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && void a.addIceCandidate(e.candidate);
    const tr = a.addTransceiver(track, { direction: 'sendonly', sendEncodings: [{ maxBitrate: 8_000_000, maxFramerate: 60 }] });
    let entry: Record<string, unknown> = { mimeType: codec.mimeType, fmtp: codec.sdpFmtpLine };
    try {
      tr.setCodecPreferences([codec]);
      await a.setLocalDescription();
      await b.setRemoteDescription(a.localDescription!);
      await b.setLocalDescription();
      await a.setRemoteDescription(b.localDescription!);
      await sleep(10000); // bandwidth estimate ramps up from ~300 kbps on a fresh connection
      entry.cpuTotal = Math.round((await window.spike.metrics()).reduce((sum, m) => sum + m.cpu, 0) * 10) / 10;
      const stats = await a.getStats();
      stats.forEach((s: Record<string, unknown>) => {
        if (s.type === 'outbound-rtp') {
          entry = { ...entry, encoder: s.encoderImplementation, hw: s.powerEfficientEncoder, fps: s.framesPerSecond, size: `${String(s.frameWidth)}x${String(s.frameHeight)}`, limit: s.qualityLimitationReason };
        }
      });
    } catch (e) {
      entry.error = String(e);
    }
    webrtc.push(entry);
    a.close();
    b.close();
    stop();
    track.stop();
  }

  for (const t of unlock.getTracks()) t.stop();
  const webcodecs: Record<string, unknown> = {};
  for (const codec of ['avc1.42e01f', 'avc1.42001f', 'avc1.4d0028', 'avc1.640028', 'hvc1.1.6.L120.B0', 'vp8', 'vp09.00.40.08', 'av01.0.08M.08']) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, framerate: 60, bitrate: 8_000_000, hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime' });
      webcodecs[codec] = r.supported;
    } catch (e) {
      webcodecs[codec] = String(e);
    }
  }
  return { webrtc, webcodecsHardware: webcodecs };
}

// ---------------------------------------------------------------- S2 auto

/** Decodes audio bytes and resamples them to `rate`, mono. */
async function decodeAt(bytes: ArrayBuffer, rate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: rate });
  return (await ctx.decodeAudioData(bytes.slice(0))).getChannelData(0);
}

/** Resamples a mono signal with the browser's resampler. */
async function resample(signal: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to) return signal;
  const length = Math.ceil((signal.length * to) / from);
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length, sampleRate: to });
  const buffer = ctx.createBuffer(1, signal.length, from);
  buffer.copyToChannel(signal as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
};
const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -120);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Background noise for S2: a fan (pink noise) plus keyboard clicks, and/or a quieter TV voice. */
function makeNoise(length: number, rate: number, kinds: { fanAndKeys: boolean; tv?: Float32Array }): Float32Array {
  const n = new Float32Array(length);
  if (kinds.fanAndKeys) {
  // Pink noise (Paul Kellet's filter) at about -38 dBFS: a fan or air conditioner.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    n[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.0035;
    b6 = w * 0.115926;
  }
  // Keyboard clicks: short decaying bursts, irregular, ~7 per second.
  for (let t = 0.2 * rate; t < length; t += rate * (0.08 + Math.random() * 0.22)) {
    const amp = 0.08 + Math.random() * 0.12;
    for (let k = 0; k < rate * 0.006 && t + k < length; k++) n[Math.floor(t + k)]! += amp * (Math.random() * 2 - 1) * Math.exp(-k / (rate * 0.0012));
  }
  }
  // TV in the background, looped, about 14 dB below the speaker.
  const tv = kinds.tv;
  if (tv) for (let i = 0; i < length; i++) n[i]! += tv[i % tv.length]! * 0.2;
  return n;
}

/** Plays `input` (48 kHz) through `makeNode` in a real-time AudioContext at `rate`, and records the output. */
async function runThrough(
  input: Float32Array,
  rate: number,
  makeNode: (ctx: AudioContext) => Promise<{ node: AudioNode; ready: Promise<unknown>; dispose(): void }>,
): Promise<{ output: Float32Array; readyMs: number; cpu: number[] }> {
  const ctx = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
  await ctx.resume();
  const t0 = performance.now();
  const handle = await makeNode(ctx);
  await handle.ready;
  const readyMs = performance.now() - t0;
  const buffer = ctx.createBuffer(1, input.length, 48000);
  buffer.copyToChannel(input as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const chunks: Float32Array[] = [];
  const recorder = ctx.createScriptProcessor(4096, 1, 1);
  recorder.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(handle.node).connect(recorder).connect(mute).connect(ctx.destination);
  const cpu: number[] = [];
  const cpuTimer = setInterval(() => void window.spike.metrics().then((m) => cpu.push(m.reduce((a, x) => a + x.cpu, 0))), 1000);
  src.start();
  await sleep((input.length / 48000) * 1000 + 1500);
  clearInterval(cpuTimer);
  handle.dispose();
  await ctx.close();
  const output = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    output.set(c, o);
    o += c.length;
  }
  return { output, readyMs, cpu };
}

/** Delay (samples) of `y` behind `ref`, by cross-correlation: coarse on every 8th sample, then refined. */
function findDelay(y: Float32Array, ref: Float32Array, maxLag: number): number {
  const corr = (lag: number, step: number) => {
    let sum = 0;
    for (let i = 0; i + lag < y.length && i < ref.length; i += step) sum += y[i + lag]! * ref[i]!;
    return sum;
  };
  let best = 0, bestVal = -Infinity;
  for (let lag = 0; lag <= maxLag; lag += 8) {
    const v = corr(lag, 8);
    if (v > bestVal) [best, bestVal] = [lag, v];
  }
  let fine = best;
  bestVal = -Infinity;
  for (let lag = Math.max(0, best - 16); lag <= best + 16; lag++) {
    const v = corr(lag, 2);
    if (v > bestVal) [fine, bestVal] = [lag, v];
  }
  return fine;
}

/** Scale-invariant signal-to-distortion ratio of `est` against `ref`, in dB. Higher is better. */
function siSdr(est: Float32Array, ref: Float32Array): number {
  let dot = 0, refE = 0;
  const n = Math.min(est.length, ref.length);
  for (let i = 0; i < n; i++) {
    dot += est[i]! * ref[i]!;
    refE += ref[i]! * ref[i]!;
  }
  const a = dot / refE;
  let target = 0, err = 0;
  for (let i = 0; i < n; i++) {
    const t = a * ref[i]!;
    target += t * t;
    err += (est[i]! - t) ** 2;
  }
  return 10 * Math.log10(target / err);
}

/** 16-bit mono WAV. */
function wav(signal: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + signal.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + signal.length * 2, true); str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, signal.length * 2, true);
  for (let i = 0; i < signal.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, signal[i]!)) * 0x7fff, true);
  return new Uint8Array(out.buffer);
}

async function s2Auto(): Promise<void> {
  const status = el('pre', 'Automatic S2 run (noise suppression). Takes about 2 minutes.');
  const result: Record<string, unknown> = { info: await window.spike.info(), startedAt: new Date().toISOString() };
  try {
    const speechBytes = await window.spike.readInput('speech');
    if (!speechBytes) throw new Error('pass --speech=<wav>');
    const tvBytes = await window.spike.readInput('tv');
    if (!tvBytes) throw new Error('pass --tv=<wav>');
    const speech = await decodeAt(speechBytes, 48000);
    const tv = await decodeAt(tvBytes, 48000);
    // Two scenarios: noise that must go (fan + keyboard), and a background voice, which a noise
    // suppressor is expected to keep (it removes noise, not other people).
    const fanNoise = makeNoise(speech.length, 48000, { fanAndKeys: true });
    const tvNoise = makeNoise(speech.length, 48000, { fanAndKeys: false, tv });
    const fanMix = speech.map((v, i) => v + fanNoise[i]!);
    const tvMix = speech.map((v, i) => v + tvNoise[i]!);

    // Speech activity from the clean speech, in 20 ms frames.
    const frame = 960;
    const frameRms = Array.from({ length: Math.floor(speech.length / frame) }, (_, f) => rms(speech, f * frame, (f + 1) * frame));
    const threshold = Math.max(...frameRms) * 0.05;
    const active = frameRms.map((r) => r > threshold);
    // True pauses: no speech at all (0.1 % of peak) within 300 ms, so quiet word endings don't count as noise.
    const quiet = frameRms.map((r) => r <= Math.max(...frameRms) * 0.001);
    const pause = quiet.map((_, f) => quiet.slice(Math.max(0, f - 15), f + 16).every(Boolean));
    result.input = {
      seconds: round1(speech.length / 48000),
      speechActivePercent: round1((100 * active.filter(Boolean).length) / active.length),
      speechDbfs: round1(db(rms(speech))),
      fanAndKeysDbfs: round1(db(rms(fanNoise))),
      tvDbfs: round1(db(rms(tvNoise))),
      fanMixSiSdr: round1(siSdr(fanMix, speech)),
      tvMixSiSdr: round1(siSdr(tvMix, speech)),
    };
    await window.spike.saveOutput('input-fan-keyboard.wav', wav(fanMix, 48000));
    await window.spike.saveOutput('input-tv.wav', wav(tvMix, 48000));

    /** Quality of `output` (at `rate`) against the clean speech. */
    const evaluate = async (output: Float32Array, rate: number, input: Float32Array) => {
      const ref = await resample(speech, 48000, rate);
      const inp = await resample(input, 48000, rate);
      const delay = findDelay(output, ref, Math.round(rate * 0.25));
      const aligned = output.subarray(delay, delay + ref.length);
      const per = Math.round((frame * rate) / 48000);
      const sum = { pauseIn: 0, pauseOut: 0, speechRef: 0, speechOut: 0, nPause: 0, nSpeech: 0 };
      active.forEach((isSpeech, f) => {
        const a = f * per, b = Math.min(aligned.length, (f + 1) * per);
        if (b <= a) return;
        if (isSpeech) {
          sum.speechRef += rms(ref, a, b) ** 2; sum.speechOut += rms(aligned, a, b) ** 2; sum.nSpeech++;
        } else if (pause[f]) {
          sum.pauseIn += rms(inp, a, b) ** 2; sum.pauseOut += rms(aligned, a, b) ** 2; sum.nPause++;
        }
      });
      return {
        latencyMs: round1((delay / rate) * 1000),
        siSdr: round1(siSdr(aligned, ref)),
        // How much quieter the gaps between sentences get (noise removed).
        pauseNoiseReductionDb: round1(db(Math.sqrt(sum.pauseIn / sum.nPause)) - db(Math.sqrt(sum.pauseOut / sum.nPause))),
        // How the voice level changes while speaking (0 is ideal; very negative means the voice is eaten).
        speechLevelChangeDb: round1(db(Math.sqrt(sum.speechOut / sum.nSpeech)) - db(Math.sqrt(sum.speechRef / sum.nSpeech))),
        aligned,
      };
    };

    const runs: Record<string, unknown> = {};
    const dfn = async (name: string, input: Float32Array, options: Parameters<typeof createDeepFilterNetAudioWorklet>[1] = {}) => {
      status.textContent = `S2: ${name}`;
      let report: LoadReport | undefined;
      let overload: number | undefined;
      const r = await runThrough(input, DEEPFILTERNET_SAMPLE_RATE, (ctx) =>
        createDeepFilterNetAudioWorklet(ctx, { loadReportAfterMs: 20_000, onLoadReport: (x) => (report = x), onOverload: (l) => (overload = l), ...options }),
      );
      const q = await evaluate(r.output, DEEPFILTERNET_SAMPLE_RATE, input);
      await window.spike.saveOutput(`${name}.wav`, wav(q.aligned, DEEPFILTERNET_SAMPLE_RATE));
      runs[name] = { readyMs: Math.round(r.readyMs), loadReport: report, overload, cpuMedian: summarize(r.cpu.map((c) => ({ c }))).c, ...q, aligned: undefined };
    };
    const dtln = async (name: string, input: Float32Array) => {
      status.textContent = `S2: ${name}`;
      const d = await runThrough(input, 16000, (ctx) => createNoiseSuppressionAudioWorklet(ctx));
      const dq = await evaluate(d.output, 16000, input);
      await window.spike.saveOutput(`${name}.wav`, wav(dq.aligned, 16000));
      runs[name] = { readyMs: Math.round(d.readyMs), cpuMedian: summarize(d.cpu.map((c) => ({ c }))).c, ...dq, aligned: undefined };
    };
    await dfn('deepfilternet-fan-keyboard', fanMix);
    // The library suggests 2–3 so single keystrokes don't open the pause gate.
    await dfn('deepfilternet-fan-keyboard-min3', fanMix, { minSpeechFrames: 3, pauseGateLookaheadFrames: 4 });
    await dfn('deepfilternet-tv', tvMix);
    await dfn('deepfilternet-clean-speech', speech); // must not damage a clean voice (pause numbers are meaningless here)
    await dtln('dtln-fan-keyboard', fanMix);
    await dtln('dtln-tv', tvMix);
    result.runs = runs;
  } catch (e) {
    result.error = String(e);
  }
  result.finishedAt = new Date().toISOString();
  await window.spike.autoResult(result);
}

async function auto(): Promise<void> {
  const only = new URLSearchParams(location.search).get('only') ?? '';
  if (only === 's2') return s2Auto();
  document.body.style.margin = '0';
  const status = el('pre', 'Automatic S1 run. Please do not touch this window.');
  const canvas = el('canvas') as HTMLCanvasElement;
  canvas.width = 1400;
  canvas.height = 820;
  const stopAnimation = animate(canvas); // screen content that changes every frame
  const result: Record<string, unknown> = { info: await window.spike.info(), startedAt: new Date().toISOString() };
  const say = (line: string) => {
    status.textContent = line;
  };

  try {
    // `--only=livekit` skips the local probe and the echo test.
    if (only !== 'livekit') {
    result.encoderProbe = await probeEncoders();
    // Echo: the tone from this window must not reach the captured system audio with restrictOwnAudio,
    // and must reach it without (the control, proving the test can detect it at all).
    const echo: Record<string, number> = {};
    for (const restrict of [true, false]) {
      say(`echo test, restrictOwnAudio=${restrict}`);
      const s = await captureScreen(restrict);
      const a = s.getAudioTracks()[0];
      if (!a) throw new Error('no system audio track');
      await sleep(1000);
      const quiet = await averageLevel(a, 2000);
      const tone = playTone(2500);
      await sleep(250); // let the tone start before measuring
      const withTone = await averageLevel(a, 2000);
      await tone;
      echo[`restrict_${restrict}_silenceDb`] = Math.round(quiet * 10) / 10;
      echo[`restrict_${restrict}_toneDb`] = Math.round(withTone * 10) / 10;
      for (const t of s.getTracks()) t.stop();
    }
    result.echo = echo;
    }
    // `--only=probe` needs no LiveKit server, so it runs on any machine as is.
    if (only === 'probe') throw new Error('stopped before the LiveKit runs (--only=probe)');

    const room = await connect(`auto-${Date.now()}`);
    // A subscriber in the same page, to check the video actually arrives and decodes through the SFU.
    const viewerRoom = await connect(`auto-viewer-${Date.now()}`);
    const viewerVideo = el('video') as HTMLVideoElement;
    viewerVideo.muted = true;
    viewerVideo.autoplay = true;
    viewerVideo.style.cssText = 'position:fixed;right:0;bottom:0;width:320px';
    const remoteVideo = (): RemoteTrack | undefined => {
      for (const p of viewerRoom.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind === Track.Kind.Video && pub.track) return pub.track;
        }
      }
      return undefined;
    };
    const screen = await captureScreen(true);
    const video = screen.getVideoTracks()[0]!;
    result.captureSettings = video.getSettings();

    const runs: Record<string, Sample> = {};
    const measure = async (name: string, track: MediaStreamTrack, source: Track.Source, codec: string, hint: string) => {
      say(`measuring ${name}`);
      track.contentHint = hint;
      const encoding = { maxBitrate: 8_000_000, maxFramerate: 60 };
      const pub = await room.localParticipant.publishTrack(track, {
        source,
        videoCodec: codec as VideoCodec,
        backupCodec: false,
        simulcast: false,
        videoEncoding: encoding,
        screenShareEncoding: encoding,
        degradationPreference: hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
      });
      const prev = new Map<string, Sample>();
      const samples: Sample[] = [];
      for (let i = 0; i < 16; i++) {
        await sleep(1000);
        const sample = await sampleVideo(pub.track!, prev);
        const rt = remoteVideo();
        if (rt) {
          if (viewerVideo.srcObject !== rt.mediaStream) rt.attach(viewerVideo);
          Object.assign(sample, await sampleInbound(rt));
        }
        if (i >= 5) samples.push(sample); // skip the bandwidth ramp-up
      }
      runs[name] = summarize(samples);
      await room.localParticipant.unpublishTrack(track, false);
      await sleep(1000);
    };

    for (const codec of ['h264', 'h265', 'vp8', 'vp9', 'av1']) {
      await measure(`screen ${codec} motion`, video, Track.Source.ScreenShare, codec, 'motion');
    }
    await measure('screen h264 detail', video, Track.Source.ScreenShare, 'h264', 'detail');

    // Hardware-encoding experiment: a canvas track is not screen content.
    for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const stop = animate(c);
      const t = c.captureStream(60).getVideoTracks()[0]!;
      await measure(`canvas ${w}x${h} h264`, t, Track.Source.Camera, 'h264', 'motion');
      stop();
      t.stop();
    }
    result.runs = runs;
    for (const t of screen.getTracks()) t.stop();
    await room.disconnect();
    await viewerRoom.disconnect();
  } catch (e) {
    result.error = String(e);
  }
  stopAnimation();
  result.finishedAt = new Date().toISOString();
  await window.spike.autoResult(result);
}

void (role === 'viewer' ? viewer() : role === 'auto' ? auto() : publisher());
