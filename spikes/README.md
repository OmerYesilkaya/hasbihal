# Spikes

Throwaway experiments that answer a technical question before product code depends on it ([ROADMAP](../docs/ROADMAP.md) M0). Nothing here is product code. It isn't linted or formatted, and gets deleted once the findings are recorded in [DECISIONS.md](../docs/DECISIONS.md).

## `media/`: S1 and S2

One small Electron app that opens two windows:

- **Publisher.** S1 captures the screen with system audio and publishes it to LiveKit at up to 1080p60. S2 runs DeepFilterNet3 on the microphone and publishes the result.
- **Viewer.** Subscribes to the publisher and shows the received video, audio levels, and stats.

Both windows show CPU usage per Electron process.

### Run it

1. Start Docker Desktop, then start LiveKit:
   ```bash
   pnpm infra:up
   ```
2. Use the **packaged** app. A dev run uses Electron's own `Info.plist`, which lacks `NSAudioCaptureUsageDescription`, so system audio would be silently empty:
   ```bash
   pnpm --filter @hasbihal/spike-media package
   open "spikes/media/release/mac-arm64/Hasbihal Spike.app"
   ```
   On first launch macOS asks for **Screen Recording** permission (for S1) and **Microphone** permission (for S2). Grant them, then quit and reopen the app if macOS asks you to.

### Automatic mode

Measures without anyone clicking. It writes a JSON file and quits. A bare file name is written to the Desktop.

- `--only=probe` (about 3 minutes, **no LiveKit needed**): for every codec variant Chromium offers, which encoder it gets (hardware or software), the fps, size, and CPU, sent over a local peer connection. Also what WebCodecs reports as hardware-capable, and the `restrictOwnAudio` echo test with its control.
- Without `--only`: the probe, then screen share through LiveKit with each codec (another 2–3 minutes).

```bash
# macOS
open -n -W "spikes/media/release/mac-arm64/Hasbihal Spike.app" --args --auto=hasbihal-probe.json --only=probe
```

```powershell
# Windows, in the unzipped win-unpacked folder (PowerShell)
& ".\Hasbihal Spike.exe" --auto=hasbihal-probe.json --only=probe
```

To build the Windows copy on a Mac: `pnpm --filter @hasbihal/spike-media exec electron-builder --config electron-builder.yml --win --x64 --dir`. Then zip `release/win-unpacked`.

### S1 checklist (screen share + system audio)

In the publisher window, click **Capture screen + system audio**, then **Publish to LiveKit**. Play a YouTube video or some music in another app.

| # | Check | Pass when |
|---|-------|-----------|
| 1 | An audio track is returned | The capture info shows `audio: label=…`, not `audio: NONE` |
| 2 | System audio is not silent | The "Captured system audio" meter moves with the music |
| 3 | 1080p60 is captured | The video settings show 1920×1080 (or your screen's scaled size) at 60 fps |
| 4 | 1080p60 is sent | Outbound stats show close to 60 fps with no persistent `limit=cpu`/`bandwidth`. Try each codec; note which has hardware encoding (`enc=`) |
| 5 | The viewer receives it | Viewer video is smooth, and the "Received screen audio" meter moves |
| 6 | Audio/video stay in sync | Watch a video with speech in the viewer for a minute; lips match |
| 7 | No recapture/echo loop | Stop the music. In the viewer, tick **Play received audio**. If the publisher's system-audio meter climbs on its own, or a howl builds up, our own playback is being recaptured |
| 8 | CPU cost | Note total CPU while sharing 1080p60 |
| 9 | Re-signing | Rebuild the app (`package` again) and relaunch. Permissions must not be asked again (DECISIONS A50) |

### S2 checklist (DeepFilterNet3)

In the publisher window, click **Start microphone**. Use headphones and tick **Monitor processed mic locally**.

| # | Check | Pass when |
|---|-------|-----------|
| 1 | Loads offline | "DeepFilterNet ready in … ms" appears. The model is bundled, so no network is needed |
| 2 | Suppression quality | Type on the keyboard, run a fan, play TV in the background while talking. Toggle the checkbox to compare |
| 3 | Voice quality | Your voice stays natural, without a metallic or underwater sound or clipped word starts |
| 4 | CPU on this machine | After 20 s the load report appears. `medianLoad` and `p95Load` are fractions of real time; below 0.3 is comfortable |
| 5 | Weakest family machines | Repeat items 1–4 on the oldest Mac **and** the oldest Windows PC in the family. Note any `OVERLOAD` lines |

### Findings

_Fill in after running, then copy the conclusions into DECISIONS.md._

| Spike | Machine | Result | Notes |
|-------|---------|--------|-------|
| S1 run 1 | Owner's Mac (macOS 26.6, Apple Silicon) | Partial | ✅ System audio captured (Core Audio Tap). ❌ ~15 fps sent instead of 60; cause not yet known (diagnostics added for run 2). ❌ Playing received audio caused an echo loop: our own playback is recaptured. ⚠️ Re-signing: the first rebuild didn't re-ask, but the next one did. After it, macOS keeps asking even though Settings shows the app as allowed (the stale entry belongs to the old signature). CPU low (~6–8 % total) but measured at ~15 fps. A/V sync not checked: it needs a second machine. |
| S1 run 2 | Owner's Mac | Partial | ✅ Capture delivers 1920×1080 at 60 fps (measured in the preview). ✅ Echo loop fixed: with `restrictOwnAudio` (supported in Electron 45), a test tone played in the app's own window doesn't reach the captured system audio. ❌ Still ~15 fps sent with every codec, with `limit=none`. Cause found: for ScreenShare sources livekit-client ignores `videoEncoding` and applies `screenShareEncoding`, which defaults to 1080p, 15 fps, 2.5 Mbps (that cap also caused h264's `limit=bandwidth` drop to 830×539). All encoders were software (OpenH264, libvpx, libaom); hardware encoding still to be checked. The "vp8" row reported `enc=OpenH264`, so it was probably h264 again. |
| S1 run 3 | Owner's Mac | ✅ fps / ❓ hw | With `screenShareEncoding` set to 60 fps and 8 Mbps, the encoder gets 1660×1078 at ~57 fps and sends close to it. Results with contentHint=motion: vp9 55 fps at 5.5 Mbps, 8.1 ms/frame; vp8 55 fps at 7.5 Mbps, 8.2 ms; av1 57 fps at 3.0 Mbps, 7.7 ms (best compression); h264 58 fps but shrunk to 621×402 (`limit=bandwidth`), 5.5 ms. h264 with contentHint=detail: full size but 28 fps, 1.1 Mbps, 21.3 ms/frame. **Every encoder is software** (`hw=false`, OpenH264/libvpx/libaom), even h264, where Chrome normally uses VideoToolbox. ~8 ms/frame at 60 fps is about half a CPU core, so hardware encoding matters for weaker machines. The bandwidth estimate stays at 5–9 Mbps even on localhost. |
| S1 auto run | Owner's Mac (M-series) | ✅ | Automatic mode (`--auto=<file>`; see below), with a busy animation as screen content. **Echo:** with `restrictOwnAudio`, a tone played by the app itself is captured at −100 dBFS (silence); without it, at −17 dBFS, so the fix works and the test can detect the problem. **Hardware encoding:** on macOS, Chromium uses VideoToolbox for H.264 Baseline `42001f`, Main `4d001f`, High `640034`, and for H.265, but **OpenH264 (software) for Constrained Baseline `42e01f`**, which is what LiveKit negotiates. Through LiveKit, h265 gets hardware encoding: 1660×1078 at 57 fps, 5.6 Mbps, `limit=none`, 7.9 % CPU, compared with 13.7 % for vp9 (software). vp8/vp9/av1 are software on this Mac but still reach ~57 fps at 8 Mbps. **Caveat:** this is one Mac; most of the family uses Windows, so the codec choice waits for Windows data. |
| S1 probe, Windows | Strong PC, NVIDIA GPU (Windows 11, x64) | ✅ | Same pattern as the Mac: H.264 Constrained Baseline `42e01f` (LiveKit's default) → **OpenH264 (software)**. H.264 Baseline `42001f`, Main `4d001f`, and High `640032` (packetization-mode=1) and H.265 → **NVIDIA encoder via Media Foundation (hardware)**, 1080p60. AV1 is hardware-capable per WebCodecs, but WebRTC still uses libaom (software). VP8/VP9 are always software. **Echo fix works on Windows too:** tone captured at −100 dBFS with `restrictOwnAudio`, −17 dBFS without. |
| S1 probe, Windows, weak simulation | Same PC, 4 cores (`/affinity 55`), `--disable-accelerated-video-encode` | ✅ | Everything falls back to software. H.264 High and H.265 then **aren't offered at all** (Chromium has no software encoder for them), so a PC without a hardware encoder can only send Constrained Baseline/Baseline/Main H.264 (OpenH264), VP8, VP9, or AV1. VP9 in software still reached 1080p at 57–60 fps on 4 fast cores. The CPU % figure isn't reliable enough to compare, and this PC's cores are much faster than an old PC's, so real weak machines still need a test. |
| S1 LiveKit H.264 profile | Owner's Mac, temporary LiveKit with a codec config | ✅ | By default LiveKit offers H.264 only as Constrained Baseline `42e01f` (plus High `640032`, which comes later in Chrome's offer), so Chrome picks software OpenH264. LiveKit also has Baseline `42001f` and Main `4d001f` built in, but they need an exact `fmtp_line` in `room.enabled_codecs`. A plain `mime: video/h264` entry must stay as well, otherwise the server swaps h264 for VP8 when a track is published. With `video/h264` plus `fmtp_line: level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f` (and 4d001f, 640032), the negotiated codec is `42001f`: **VideoToolbox hardware encoding**, 1660×1078 at 57 fps (and 1920×1080 at 60 from a canvas), ~7.9 Mbps, `limit=none`. The subscriber in the same run receives full size at 57–60 fps with **hardware decoding**. `42001f` is also hardware-encoded on the NVIDIA PC (probe), and a PC without a hardware encoder still sends it through OpenH264 in software. |
| S1 signing | Owner's Mac | ✅ Pass | Signed with the "Hasbihal Self-Signed" certificate (A50). Designated requirement = bundle ID + certificate leaf, without the cdhash. After removing the stale entries once and granting again, a rebuild that changed the cdhash (`129b9ac8…` → `51033639…`) kept the screen, system audio, and microphone permissions without a prompt. |
| S2 | | | |
