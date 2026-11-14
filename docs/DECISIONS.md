# Hasbihal — Product & Technical Decisions

Living document. Each decision records **what** we chose and **why**. Nothing is final; when we change our minds, we update the entry and note the change.

Status legend: ✅ Agreed · 🟡 Leaning (recommendation, not yet confirmed) · ❓ Open

---

## 1. Vision

A private, opinionated app for chatting with friends and family by text, voice, and video. It plays the role Discord plays, but for one small trusted group, without Discord's public-community features.

## 2. Agreed

| # | Decision | Why |
|---|----------|-----|
| A1 | ✅ Native desktop app for **macOS and Windows** | Owner requirement |
| A2 | ✅ **Not a website**: no browser-based client | Owner requirement |
| A3 | ✅ **Private and invite-only**, not for the general public | Owner requirement. This also lets us skip moderation tooling, discovery, and anti-abuse features. |
| A4 | ✅ **Self-hosted on one VPS** that the owner controls. The app server and an open-source media server (e.g. LiveKit) run there. | Full control and low cost (~$10–30/mo). Unlike a home server, it doesn't depend on home upload bandwidth or uptime. Pure P2P was rejected: group video doesn't scale on mesh, and offline delivery and history sync get hard. |
| A5 | ✅ **Desktop first, mobile (iOS/Android) eventually.** The tech stack must allow sharing most code with future mobile apps. | Family members will want phones for notifications and calls on the go. Choosing a desktop-only stack now would force a rewrite later. |
| A6 | ✅ **Voice and video use drop-in rooms only** (Discord model). There are no ringing calls. | Owner preference: a hangout feel, not a phone. |
| A7 | ✅ **Data minimization.** The server stores only what the app needs to work: accounts, room membership, messages, and files. No analytics, tracking, or call recordings. | Owner preference. The server still has some unavoidable metadata (who is in which room, timestamps, who sent what) because routing messages requires it. |
| A8 | ✅ **Everything is shared.** There are no private DMs or private rooms. Any signed-in member can see, read, and join every room, including rooms created later. | This app is a shared hangout. Private one-to-one conversations belong on WhatsApp. |
| A9 | ✅ **One shared space** for all members, with no separate "servers" (follows from A8). | One group, one place. |
| A10 | ✅ **No end-to-end encryption.** Traffic is encrypted in transit (TLS), and the server's disk and backups are encrypted at rest. | Under A8 nothing is private between members, so E2EE would only protect against the operator, who is himself a member. The remaining risk is a VPS compromise. We handle that with server hardening and encrypted backups, not E2EE, which costs device-linking UX and a lot of complexity. If private spaces are ever added, revisit this. |
| A11 | ✅ **Combined rooms.** Each room has both a text chat and a drop-in voice/video area. | One place per topic. You see who is hanging out right next to the conversation. |
| A12 | ✅ **Only admins manage rooms**: create, rename, archive, delete. Admin rights are handed out generously. Roles are just *admin* and *member*. | Keeps the room list tidy without bottlenecking on one person. |
| A13 | ✅ **Nudge.** A member can nudge another member into a room, which sends a strong notification like "Omer wants you in Living Room". | Replaces ringing, given A6. |
| A14 | ✅ **Screen sharing: up to 1080p at 60 fps, with system audio.** Several people can share at once in the same room, and each viewer picks which share to watch. | Owner requirement. Watching videos or games together is a core hangout use, so smooth motion and sound matter. |
| A15 | ✅ **Recurring events tied to a room.** For example, "Lecture, every Monday 09:00, in room X, invited: X and Y". Invitees get a reminder before the start. Anyone may still join the room as usual, since invitations notify people and don't restrict access (A8). | Owner requirement. Supports regular get-togethers. |
| A16 | ✅ **Event details.** Only admins create and edit events. One-off and recurring events are both supported, and a single occurrence can be skipped or moved. The reminder offset is set per event in its config (default 10 minutes). Members can RSVP (coming / can't make it). There is no export to external calendars for now. | Consistent with A12 (admins manage structure). |
| A17 | ✅ **Turkey only.** All members are in Turkey, so the app uses one time zone (Europe/Istanbul). Times are still stored as proper UTC instants with a time-zone rule, so this can be relaxed later. | Simplifies event scheduling. Turkey has had no DST since 2016. |
| A18 | ✅ **Turkish is the primary UI language, with English also supported.** Every string is localized from day one, with no hard-coded text. | Owner requirement. |
| A19 | ✅ **Presence modes and nudge rules.** Users set a mode (e.g. Available, Busy). Anyone can nudge anyone. A Busy / Do Not Disturb mode suppresses nudges and notifications. Nudges have a short cooldown per sender and recipient. | Respects people's time and prevents spam. |
| A20 | ✅ **Only admins invite new people and remove members.** | Keeps the circle trusted. |
| A21 | ✅ **Presence.** The modes are Available, Away, and Busy. Away is set automatically after ~10 minutes idle. There is no Invisible mode and no custom status text. The member list shows which room each person is in (e.g. "🔊 Living Room"). | An open hangout should show who is around and where. Invisible goes against that. |
| A22 | ✅ **Chat features.** Included: replies, emoji reactions, editing your own messages (shown with an "edited" label under the message), and deleting your own messages (leaves a "message was deleted" placeholder). Also included: @mentions including @everyone, typing indicators, link previews, and voice messages. **Not included:** read receipts, threads, and a GIF picker. | A small group needs the essentials. Read receipts create social pressure, and threads are overkill at this size. |
| A23 | ✅ **GIFs are rendered, not searched.** GIF files that are uploaded or pasted play inline like any image. There is no built-in GIF search, so no third-party GIF service is used. | Rendering a GIF needs no external library or service. Only a search/picker would (A7). |
| A24 | ✅ **Link previews are fetched by our server**, not by each client. | Members' devices and IP addresses don't hit arbitrary third-party sites, and every client gets the same preview. |
| A25 | ✅ **Onboarding and sign-in.** An admin creates a single-use invite link. The invitee opens it in the app, picks a display name and avatar, and sets a password. Sessions are long-lived, using a short-lived access token plus a rotating refresh token, so people rarely need to sign in again. Passwords are hashed with Argon2id. There are no passkeys. Admins can issue a single-use recovery link if someone is locked out. | Owner preference: passwords are familiar to everyone. Long sessions keep friction near zero. |
| A26 | ✅ **Files and media.** Uploads are limited to 100 MB per file. Originals are kept, never recompressed, and the server generates thumbnails for fast display. Images and videos play inline with a full-screen viewer, and other files show as download cards. | Family photos and videos deserve full quality. The owner manages storage capacity. |
| A27 | ✅ **History is kept forever, with full-text search.** Search covers all rooms and is Turkish-aware (ı/i, ş/s, ç/c, ğ/g, ö/o, ü/u fold together). | It's a shared archive, and text is tiny. If disk ever runs short, files can move to S3-compatible object storage rather than being deleted. |
| A28 | ✅ **Notifications.** By default, mentions, nudges, and event reminders always notify. Ordinary messages are silent and only show an unread badge. "Hangout started" (someone joins an empty room) also notifies by default. Each person can change this per room: notify with sound on every message, turn off hangout-started alerts, or mute the room. Busy mode (A19) suppresses all of these. | Quiet by default, with the important things loud. |
| A29 | ✅ **Voice quality is a top priority, at Discord level or better**, with strong noise cancellation. Implementation (🟡, see T7): Opus at high bitrate (~64–128 kbps for voice, stereo music mode for shared audio), redundant audio (RED) and in-band FEC against packet loss, AEC3 echo cancellation, and ML noise suppression **running locally on the device** (no cloud service). Users can toggle it and get per-person volume control. | Owner requirement. Voice quality is the product's core experience. |
| A30 | ✅ **Distribution: plain installers (.dmg / .exe), unsigned, no auto-update.** The app is tested with a small group of technical family members until stable, then released. Updates are rare and announced manually by the owner, who also handles onboarding. | Owner preference: a stable, finished app, not a constantly changing one, and no signing costs. |
| A31 | ✅ **Nightly encrypted off-site backups** of the database and files (e.g. Backblaze B2), with periodic restore tests. | Protects the forever-history (A27). |
| A32 | ✅ **Hosting budget ~€10–25/month** (VPS plus backup storage). | Fits tens of users. |
| A33 | ✅ **Version compatibility notice.** The client reports its version on connect. If the server no longer supports it, the app shows a clear "Please download the new version" screen with the download link. Nothing is downloaded automatically. | Without auto-update (A30), an old client must fail clearly, not in confusing ways. |
| A34 | ✅ **Scale.** 30–40 members in total. Peak of ~10 people in one call, usually 3–5. | Sizing: at peak (10 people with video plus one 1080p60 screen share), the server sends out roughly 150–200 Mbps. A 4 vCPU VPS with a 1 Gbps port and generous monthly traffic handles this comfortably within A32. |
| A35 | ✅ **Theme follows the OS setting** (light/dark). Visual direction is in A45. | |
| A36 | ✅ **Layout: three columns.** Left is the room list, showing who is in each room's hangout. Middle is the room's chat. Right is members and presence. When a hangout is active, the voice/video area opens above the chat. | Familiar and efficient. Matches combined rooms (A11). |
| A37 | ✅ **Voice controls.** Voice activation with adjustable sensitivity is the default, and push-to-talk is an option. Global keyboard shortcuts for mute and deafen work even when the app is not focused. The feature set is expected to evolve. | Standard, proven controls. |
| A38 | ✅ **Tray / menu bar.** Closing the window keeps the app running in the system tray (Windows) or menu bar (macOS), so notifications, nudges, and reminders still arrive. | Nudges (A13) and reminders (A16) only work if the app is running. |
| A39 | ✅ **Launch at startup is on by default** (users can turn it off). | Same reason as A38. |
| A40 | ✅ **Avatars.** Members can upload a photo. Without one, the avatar shows their initials on a color from a fixed palette of 8 distinct, pre-chosen colors, assigned randomly and kept stable per member. | Recognizable at a glance, even without a photo. |
| A41 | ✅ **Profile view.** Each user has a profile view, which is also where they adjust basic settings such as display name, avatar, and notification defaults. | One place for "me". |
| A42 | ✅ **Departed members' messages stay**, shown under their name, when someone leaves or is removed. | Shared history (A8, A27) stays intact. |
| A43 | ✅ **No offline mode for now.** Sending requires a connection. | Not needed yet. Revisit if it becomes a pain. |
| A44 | ✅ **Admin page.** A very simple separate tab/page, visible only to admins, for invites, members, admin rights, and rooms. | Keeps admin tools out of everyone else's way. |
| A45 | ✅ **Design direction.** Layout and UX follow **Discord's familiar patterns**, minus the features we don't have and adapted to our focus. Our own visual identity is inspired by the **Ottoman *şark odası***: the old sitting room where people sat on *minder*s and *sedir*s and talked. The palette is **Ottoman colors with red as primary**, not purple or green. Islamic/Ottoman decorative elements are used tastefully. Details are in §5. | Owner preference. The name "Hasbihal" (heart-to-heart talk) should be felt in the look. We follow Discord's interaction patterns, not its branding or assets. |
| A46 | ✅ **Palette: Saray.** Ottoman crimson `#9E1B32` (primary), gold `#C8A04A` (highlights), Iznik turquoise `#2E8B8B` and cobalt `#1F4E8C` (secondary accents), cream `#F5EDE0` (light ground), walnut `#2A1E1A` (dark ground). | Chosen after comparing Saray and Kilim on the prototype canvas. |
| A47 | ✅ **Message formatting with a Markdown subset**: **bold**, *italic*, ~~strikethrough~~, `inline code`, fenced code blocks with syntax highlighting and a copy button, block quotes, bulleted and numbered lists, and auto-linked URLs. Formatting renders live in the composer. Raw HTML is never rendered: the parser outputs a fixed set of safe elements only. | Owner requirement. Safe rendering matters even more because the app's embedded Chromium is rarely updated (A30). |
| A48 | ✅ **Formatting extras.** Spoilers (`\|\|hidden\|\|`, revealed on click) are supported. Underline and headings are **not** supported. Code highlighting ships a common language set (Python, JavaScript/TypeScript, C#, Java, Go, Rust, SQL, JSON, YAML, shell, HTML/CSS) instead of every language. | Spoilers are cheap and fun. Underline looks like a link, and headings invite shouting. A curated language set keeps the app small. |

## 3. Open questions

### 3.1 Foundations (these decide the architecture)

- ~~Q1 Hosting~~ → A4. ~~Q2 Mobile~~ → A5.
- ~~Q3 Scale~~ → A34.
- ~~Q4 E2EE~~ → A10.

### 3.2 Product shape

- ~~Q5 Space model~~ → A8, A9.
- ~~Q5a Room anatomy~~ → A11. ~~Q5b Room lifecycle~~ → A12.
- ~~Q6 Voice model~~ → A6.
  - ~~Q6a Getting someone's attention~~ → A13.
- ~~Q7 Chat feature set~~ → A22, A23, A24.
- ~~Q8 Files and media~~ → A26.
- ~~Q9 Screen sharing~~ → A14. ~~Q19 Events~~ → A16, A17. ~~Q20 Nudge~~ → A19.
- ~~Q10 Presence~~ → A21.
- ~~Q11 Notifications~~ → A28. ~~Q12 Message history~~ → A27.

### 3.3 Identity and onboarding

- ~~Q13 Accounts~~ → A25.
- ~~Q14 Roles~~ → A12.
  - ~~Q14a~~ → A20.
- ~~Q15 Language~~ → A18.

### 3.4 Operations

- ~~Q16 Updates~~ → A30. ~~Q17 Backups~~ → A31. ~~Q18 Cost~~ → A32.
- ❓ **Q22 Minimum OS versions.** Screen share with system audio on macOS uses Apple's Core Audio Tap API, which needs **macOS 14.2 (Sonoma)** or later (see ARCHITECTURE §6.2). Proposal: require macOS 14.2+ and Windows 10 22H2+. Do the family's Macs meet this?
- ~~Q21 Version notice~~ → A33.
- ⚠️ **Known consequences of A30** (accepted, listed so they're not surprises):
  - **macOS:** on first launch the app is blocked. The user must go to System Settings → Privacy & Security → "Open Anyway". On recent macOS, right-click → Open no longer bypasses this. The build is ad-hoc signed, which Apple Silicon requires to run at all.
  - **macOS:** permissions for microphone, camera, and screen recording are tied to the app's signature. With ad-hoc signing, **each new build may ask for these permissions again**. This is acceptable given rare updates.
  - **Windows:** SmartScreen shows "Windows protected your PC" → More info → Run anyway. Some antivirus products may flag unsigned apps.
  - **Security:** a never-updated app means an aging embedded Chromium. We mitigate this by only ever loading our own bundled UI (no arbitrary web pages), with a strict Content Security Policy, and by proxying external content (link previews, images) through our server (A24).

---

## 4. Tech stack (agreed)

| # | Area | Proposal | Why | Alternatives considered |
|---|------|----------|-----|-------------------------|
| T1 | Desktop app | ✅ **Electron + React + TypeScript** | It ships the same Chromium WebRTC engine on macOS and Windows, which is the most battle-tested real-time media stack (Discord, Slack, and Teams desktop use it). LiveKit's JS SDK is its flagship SDK. Electron also has mature packaging, tray, and notifications. | **Tauri** uses each OS's own webview. Safari's WKWebView on macOS is weak at screen capture and has no system audio, so media would need native code per OS. **Flutter** has one codebase including mobile, but its desktop WebRTC and screen sharing are less mature. **Native per OS** (SwiftUI + WinUI) has the best footprint but means 2 full UI codebases now and 4 later. |
| T2 | Mobile (later) | ✅ **React Native (Expo)** | It shares a TypeScript core package with desktop: API client, sync, state, i18n, and formatting. LiveKit has a first-class React Native SDK. Mobile UI should be designed for phones anyway. | Flutter (would mean a second language). |
| T3 | Backend | ✅ **TypeScript on Node.js** as a single modular server: REST for commands, WebSocket for real-time events. | One language end to end, with shared, validated types between client and server, removes a whole class of bugs. The load is tiny (tens of users). | Go: excellent for servers, but types would need to be shared through codegen. |
| T4 | Database | ✅ **PostgreSQL** | Reliable, with built-in full-text search (Turkish stemmer plus `unaccent`-style folding for A27). One database for everything. | SQLite: simpler, but weaker for concurrent writes and search. |
| T5 | Voice / video / screen share | ✅ **Self-hosted LiveKit server** (SFU) with built-in TURN. We use the free open-source server only, **not LiveKit Cloud** (their paid hosted offering). | An SFU (media relay server) is required for group calls. See the note below. LiveKit is open source (Apache-2.0) and runs only on our VPS, so no data goes to any outside service. It handles bandwidth estimation, simulcast, packet-loss recovery, reconnection, and NAT traversal, which are the things that make calls sound and look good. | **mediasoup**: an SFU library embedded in our own Node server. More control and ownership, but we write signaling, reconnection, and quality adaptation ourselves. **Our own SFU from scratch**: not recommended; it means years of specialist work and would likely sound worse. Pure P2P was rejected in A4. |
| T6 | Files | ✅ Stored on the VPS disk behind a storage interface that is S3-compatible, so they can move to object storage later without code changes. | Matches A26/A27. | |
| T7 | Noise suppression | ✅ **DeepFilterNet** (open source, runs locally in an audio worklet), with **RNNoise** as a lighter fallback for weak machines. | The best open-source ML noise suppression, it removes keyboard, fans, and background voices. No audio leaves the device. | Krisp (Discord's choice): proprietary and paid. Built-in WebRTC noise suppression: too basic for A29. |

**Why an SFU is needed (T5):** in a group call each person's audio and video must reach everyone else. Without a server, each device uploads a separate copy to every other participant. A 1080p60 screen share to 5 people would mean 5× the upload, which home connections can't sustain. With an SFU, each device uploads once and the server forwards the stream, choosing the right quality for each receiver's connection.

**Risk to check first:** capturing system audio during screen share on **macOS** (A14). Windows supports it natively in Chromium/Electron. On macOS it depends on recent OS APIs (ScreenCaptureKit / Core Audio taps). A small technical spike should confirm this works in Electron before we commit to T1.

**Deployment:** Docker Compose on one VPS, with HTTPS via Caddy or Let's Encrypt. The VPS should be **close to Turkey** to keep call latency low. A German or Finnish datacenter is ~40–60 ms away, and Turkish providers are lower.

---

## 5. Visual identity (palette agreed in A46; details 🟡)

Direction agreed in A45. Specifics are proposed below and still need confirming.

- **Prototype canvas:** https://claude.ai/artifact/8ceFZ67kEQvYi3MY15MZEY (private). It shows the main screen in both palettes (*Saray*: crimson, gold, Iznik turquoise; *Kilim*: madder red, saffron, indigo), each in dark and light, with the hangout shown as a video grid.

- **Palette (superseded by A46, Saray chosen):** Ottoman crimson as the primary color. Gold for highlights (mentions, active states). Iznik turquoise and cobalt as secondary accents (links, "in hangout" indicators). Warm cream for light-mode backgrounds and a deep walnut brown for dark-mode backgrounds, like the wood of a şark odası, not cold gray.
- **Decoration (proposal), subtle and never at the cost of readability:**
  - Low-opacity geometric patterns (girih, eight-pointed star) as texture in the sidebars.
  - Kilim- or tile-border motifs as section dividers.
  - The eight-pointed star as the shape of unread/mention badges.
  - Tulip and carnation (Iznik) motifs in the logo and empty states.
- **Hangout view:** ✅ a standard video grid like Google Meet or Discord: equal 16:9 tiles, centered, with each screen share as its own tile and the active speaker outlined. The "sedir" seating idea was rejected.
- **Sensitivity rule:** decorative elements use geometric and floral art only. **No Quranic verses, names of God, or other sacred calligraphy as decoration**, since UI elements get scrolled past, deleted, and screenshotted.
- **Avatar palette** (A40): the 8 colors come from this palette.

---

## 6. Decision log

| Date | Change |
|------|--------|
| 2026-11-13 | Document created from the initial brief. |
| 2026-11-13 | Agreed A4 (self-hosted VPS), A5 (desktop first, mobile later), A6 (drop-in rooms only), A7 (data minimization). |
| 2026-11-13 | Agreed A8 (everything shared, no DMs), A9 (one space), A10 (no E2EE). |
| 2026-11-13 | Agreed A11 (combined rooms), A12 (admins manage rooms), A13 (nudge), A14 (1080p screen share), A15 (recurring events). |
| 2026-11-14 | Agreed A16 (event details), A17 (Turkey time zone), A18 (Turkish + English), A19 (presence modes and nudge rules), A20 (admins invite and remove). Expanded A14 (60 fps, system audio, multiple shares). |
| 2026-11-14 | Agreed A21 (presence), A22 (chat features), A23 (GIFs rendered, no picker), A24 (server-side link previews), A25 (invites, passwords, long-lived sessions). |
| 2026-11-14 | Agreed A26 (files and media), A27 (history forever + search), A28 (notifications). Added tech stack proposal (T1–T6). |
| 2026-11-14 | Agreed A29 (voice quality), A30 (unsigned installers, no auto-update), A31 (backups), A32 (budget). Agreed T1–T4 and T6. T5 (LiveKit) under discussion. Proposed T7 (noise suppression) and Q21 (version notice). |
| 2026-11-14 | Agreed T5 (self-hosted LiveKit, not LiveKit Cloud), T7 (DeepFilterNet), A33 (version notice). |
| 2026-11-14 | Agreed A34 (scale), A35 (theme follows OS; design awaits owner's reference), A36 (three-column layout), A37 (voice controls), A38 (tray), A39 (launch at startup), A40 (avatars). |
| 2026-11-14 | Agreed A41 (profile view), A42 (departed members' messages stay), A43 (no offline mode), A44 (admin page), A45 (Discord-style UX, Ottoman şark odası identity, red primary). Added §5 Visual identity proposal. |
| 2026-11-14 | Built the Saray vs Kilim prototype canvas (§5). |
| 2026-11-14 | Rejected the sedir hangout view; the hangout uses a Meet/Discord-style video grid. |
| 2026-11-14 | Agreed A46 (Saray palette), A47 (Markdown message formatting). |
| 2026-11-14 | Agreed A48 (formatting extras). Added ARCHITECTURE.md and ROADMAP.md. |
