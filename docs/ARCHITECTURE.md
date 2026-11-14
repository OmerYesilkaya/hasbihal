# Hasbihal: Architecture

This document describes **how** Hasbihal is built. [DECISIONS.md](DECISIONS.md) records **what** we build and why. References like (A27) or (T5) point to entries there.

Status legend: ✅ follows directly from an agreed decision · 🟡 proposed here, not yet confirmed

---

## 1. System overview

```
┌─────────────────────────┐          ┌──────────────────────────── VPS (Docker Compose) ──────────────────────────┐
│ Desktop app (Electron)  │  HTTPS   │  ┌────────┐   ┌──────────────────┐   ┌────────────┐                         │
│  React UI               │─────────▶│  │ Caddy  │──▶│ Hasbihal server  │──▶│ PostgreSQL │                         │
│  @hasbihal/core         │  WSS     │  │ (TLS)  │   │ (Node, TS)       │   └────────────┘                         │
│  LiveKit client         │─────────▶│  └────────┘   │  REST + WebSocket│──▶ File storage (disk, S3-compatible API) │
│  DeepFilterNet (WASM)   │          │               │  scheduler       │                                          │
└───────────┬─────────────┘          │               └────────┬─────────┘                                          │
            │ WebRTC (UDP/TCP/TURN)  │                webhooks│ tokens                                             │
            └───────────────────────▶│               ┌────────▼─────────┐                                          │
                                     │               │ LiveKit server   │  (SFU + embedded TURN)                   │
                                     │               └──────────────────┘                                          │
                                     └──────────────────────────────────────────────────────────────────────────────┘
                                                      nightly ──▶ encrypted off-site backup (B2)
```

There are four runtime pieces, all on one VPS (A4) except the client:

| Piece | Role |
|-------|------|
| **Desktop app** | UI, local state, media capture, and noise suppression. It talks to our server for everything except media, which goes to LiveKit. |
| **Hasbihal server** | The single source of truth: accounts, rooms, messages, files, events, presence, and notification preferences. It issues LiveKit tokens and pushes real-time events. |
| **LiveKit server** | Relays voice, video, and screen-share media (T5). It holds no persistent data. |
| **PostgreSQL** | All persistent data except file bytes (T4). |

---

## 2. Repository layout (🟡)

One monorepo using **pnpm workspaces**, so every TypeScript package shares types (T3).

```
hasbihal/
├─ apps/
│  ├─ desktop/        Electron main + preload + React renderer (electron-vite)
│  ├─ server/         Node server: HTTP API, WebSocket gateway, scheduler, workers
│  └─ mobile/         (later, A5) React Native / Expo
├─ packages/
│  ├─ protocol/       Wire contract: zod schemas, event types, error codes, PROTOCOL_VERSION
│  ├─ core/           Client logic shared by desktop + mobile: API client, sync engine,
│  │                  stores, Markdown parser, i18n catalogs, formatting helpers
│  └─ config/         Shared tsconfig, ESLint, Prettier
├─ infra/             docker-compose.yml, Caddyfile, livekit.yaml, backup scripts
└─ docs/
```

Rule: `protocol` depends on nothing internal. `core` depends only on `protocol`. Apps depend on both. The server never imports client code, and clients never import server code.

---

## 3. Server

### 3.1 Stack (🟡)

| Concern | Choice | Why |
|---------|--------|-----|
| HTTP framework | **Fastify** | Fast and mature, with first-class schema validation and a good plugin model. |
| WebSocket | **@fastify/websocket** (`ws`) | Same process and auth path as the HTTP API. |
| Validation | **zod** schemas from `@hasbihal/protocol` | One definition is used on both sides of the wire. |
| Database access | **Kysely** (typed SQL query builder) with its migrator | Typed queries without hiding SQL. Full-text search and recursive queries stay natural. |
| Password hashing | **argon2** (Argon2id) | A25. |
| Images / video thumbnails | **sharp**; **ffmpeg** for video posters | A26. |
| Logging | **pino** (structured JSON) | Fastify's native logger. |
| Tests | **Vitest** + a real PostgreSQL via Testcontainers | Integration tests hit a real database, not mocks. |

### 3.2 Modules

The server is one process (a modular monolith). Each module owns its tables and exposes a service interface. Modules never touch each other's tables directly.

| Module | Owns | Notes |
|--------|------|-------|
| `auth` | users' credentials, sessions, invites, recovery links | A20, A25 |
| `users` | profiles, avatars, presence mode, notification prefs | A21, A28, A40, A41 |
| `rooms` | rooms, room settings, per-user room prefs | A11, A12 |
| `messages` | messages, reactions, mentions, read state, search | A22, A27, A47 |
| `files` | uploads, thumbnails, link previews | A23, A24, A26 |
| `hangouts` | LiveKit tokens, webhook intake, live room membership, nudges | A6, A13, A14 |
| `events` | events, recurrence, exceptions, RSVPs, reminder scheduling | A15, A16 |
| `gateway` | WebSocket connections, fan-out, presence tracking, replay | §5 |
| `admin` | admin-only operations | A44 |

### 3.3 Data model (🟡 first cut)

All ids are **UUIDv7**: time-ordered, safe to generate on either side, and good for index locality. All timestamps are `timestamptz` (UTC). Display uses Europe/Istanbul (A17).

```
users            id, username (unique, login), display_name, avatar_file_id?, avatar_color (0–7),
                 role ('admin'|'member'), presence_mode ('available'|'busy'),
                 created_at, removed_at?
credentials      user_id, password_hash, password_changed_at
sessions         id, user_id, refresh_token_hash, family_id, device_name, created_at,
                 last_used_at, expires_at, revoked_at?
invites          id, token_hash, created_by, expires_at, used_by?, used_at?
recovery_links   id, user_id, token_hash, created_by, expires_at, used_at?

rooms            id, name, topic?, position, created_by, archived_at?
room_user_prefs  room_id, user_id, notify_level ('mentions'|'all'|'muted'),
                 sound_on_message bool, hangout_start_alerts bool, last_read_message_id?

messages         id, room_id, author_id, body (Markdown source), reply_to_id?,
                 mentions_everyone bool, created_at, edited_at?, deleted_at?
                 + search_vector (generated tsvector, see §3.5)
message_mentions message_id, user_id
reactions        message_id, user_id, emoji, created_at       (PK: all three)
attachments      message_id, file_id, position

files            id, uploader_id, kind ('image'|'video'|'audio'|'voice'|'other'),
                 original_name, mime, size_bytes, sha256, storage_key,
                 width?, height?, duration_ms?, thumbnail_key?, created_at
link_previews    url_hash, url, title?, description?, image_file_id?, fetched_at, status

events           id, room_id, title, description?, starts_at, duration_min,
                 rrule? (RFC 5545), tz ('Europe/Istanbul'), reminder_offset_min (default 10),
                 created_by, cancelled_at?
event_invitees   event_id, user_id
event_exceptions event_id, occurrence_start, kind ('skipped'|'moved'), new_starts_at?
event_rsvps      event_id, occurrence_start, user_id, response ('yes'|'no'), updated_at

event_log        seq (bigserial), type, payload jsonb, created_at     (§5.3 replay)
jobs             (scheduler queue, §3.6)
```

Notes:
- **Deleting a message** sets `deleted_at` and clears `body`, mentions, and attachment links. The row remains, so the UI can show "Bu mesaj silindi." (A22). Files of deleted messages are garbage-collected.
- **Removing a member** sets `users.removed_at` and revokes all sessions. Their messages stay (A42).
- `last_read_message_id` drives unread badges only. It is never shown to others (A22: no read receipts).

### 3.4 API style

- **Commands go over HTTPS**: `POST /rooms/:id/messages`, `PATCH /messages/:id`, `POST /nudges`, and so on. Each request is validated by its zod schema and returns the created or updated resource.
- **Real-time updates go over one WebSocket** per client (§5). A mutation's HTTP response and its broadcast event carry the same resource, so the sender's UI updates immediately and other clients converge.
- **Sending a message is idempotent:** the client generates the message's UUIDv7 and sends it. A retry after a network blip can't create duplicates.

### 3.5 Search (A27)

- `messages.search_vector` is a generated column: `to_tsvector('hasbihal_tr', body)`.
- `hasbihal_tr` is a custom text-search configuration: the Turkish Snowball stemmer plus an **unaccent** dictionary with custom rules so that `ı↔i`, `ş↔s`, `ç↔c`, `ğ↔g`, `ö↔o`, and `ü↔u` all match.
- Lower-casing uses an **ICU `tr-TR` collation**, so `I→ı` and `İ→i` are handled correctly. A naive lower-case breaks Turkish.
- A GIN index on `search_vector`. Results are ranked by `ts_rank` and recency.

### 3.6 Background work

An in-process scheduler backed by the `jobs` table: durable, retried with backoff, and safe across restarts. At our scale there is no need for Redis or a separate worker.

Jobs: thumbnail generation, link-preview fetching, event-reminder dispatch, expired session/invite cleanup, and orphaned-file garbage collection.

---

## 4. Desktop app

### 4.1 Process model (Electron)

| Process | Responsibilities |
|---------|------------------|
| **Main** | Window and tray/menu-bar lifecycle (A38), launch at startup (A39), global shortcuts for mute/deafen/push-to-talk (A37), native notifications, idle detection (`powerMonitor`, A21), secure token storage (`safeStorage`), screen-capture source picking, and the app version reported to the server (A33). |
| **Preload** | A small typed bridge (`contextBridge`) that exposes only the main-process capabilities above. |
| **Renderer** | The React UI, `@hasbihal/core`, the LiveKit client, and audio processing. |

### 4.2 Security hardening (A30, A47)

The embedded Chromium will age (A30), so the renderer is locked down from day one:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`.
- A strict **Content Security Policy**: scripts only from the app bundle; connections only to our server origin and LiveKit; images and media only from our server's file endpoints.
- The renderer only ever loads the bundled UI. All navigation is blocked, and `window.open` is denied. External links open in the system browser through the main process, and only for `http`/`https`.
- **Message rendering never uses HTML.** The Markdown parser in `core` produces an AST, which React renders through a fixed component map (A47). There is no `dangerouslySetInnerHTML`.
- Link-preview images and all third-party content are fetched and re-served by our server (A24). The client never contacts third parties.
- Electron fuses: disable `RunAsNode`, Node CLI options, and `NODE_OPTIONS`. Enable ASAR integrity validation.

### 4.3 UI (🟡)

- React with TypeScript, built by **Vite** through **electron-vite**.
- State: a normalized client store in `core`, fed by the sync engine (§5). UI components subscribe to selectors.
- Styling uses design tokens from the Saray palette (A46) as CSS variables, with light/dark following the OS (A35). The three-column layout follows A36.
- i18n: **ICU message format** catalogs (Turkish primary, English, A18). Copy never attaches Turkish suffixes to dynamic names: "Oturma odası'na mesaj yaz" fails vowel harmony for other room names. Write "Mesaj yaz · Oturma odası" instead.
- Message lists are virtualized, since history is kept forever (A27).

### 4.4 Packaging (A30)

- **electron-builder** produces an unsigned `.dmg` (universal: Apple Silicon and Intel, ad-hoc signed) and an NSIS `.exe` installer.
- There is no auto-updater. The update screen (A33) links to the download page.
- Builds run in CI on macOS and Windows runners (§9).

---

## 5. Real-time sync

### 5.1 Connection

1. The client opens `wss://<host>/ws` and sends `hello { accessToken, clientVersion, protocolVersion, lastSeq? }`.
2. The server checks the token and the versions. If the client is too old, it replies `upgrade_required { minVersion, downloadUrl }` and closes the connection (A33).
3. Otherwise it replies `welcome { seq, me, … }`, then either replays missed events (§5.3) or tells the client to resync.
4. Heartbeats run every 20 s. The client reconnects with jittered exponential backoff.

### 5.2 Event types

| Durable (stored in `event_log`, replayable) | Ephemeral (live only) |
|---|---|
| message created / edited / deleted | typing started (expires after 6 s) |
| reaction added / removed | presence changed (online, away, busy, offline) |
| room created / renamed / archived | hangout participants changed |
| member joined / removed / role changed / profile updated | nudge received |
| event created / changed / cancelled; RSVP changed | event reminder due |

### 5.3 Catch-up after a disconnect

- Every durable event gets a global, monotonically increasing `seq`.
- The client remembers the last `seq` it applied. On reconnect it sends `lastSeq`, and the server replays everything newer **if** the gap is still in `event_log`. The log is retained for 30 days, which is plenty at our volume.
- If the gap is too old, the server sends `resync_required`. The client then refetches rooms, members, and recent messages for each room.
- Events are applied idempotently by resource id and version, so seeing an event twice is harmless.

### 5.4 Presence (A21)

- The server counts live WebSocket connections per user. Zero connections means **Çevrimdışı** (offline).
- The user picks **Müsait** (available) or **Meşgul** (busy). The main process reports system idle time, and after 10 minutes idle the client sends `away`, so the user shows as **Uzakta** (away) until activity resumes.
- "In a hangout" comes from LiveKit webhooks (§6.3), not from the client, so it can't drift.

---

## 6. Hangouts: voice, video, screen share

### 6.1 Joining

1. The client calls `POST /rooms/:id/hangout/token`.
2. The server checks membership and returns a short-lived **LiveKit access token**: room = our room id, identity = our user id, with publish/subscribe grants.
3. The client connects to LiveKit directly. Media never passes through our Node server.

### 6.2 Media settings (A29, A14)

| Track | Settings |
|-------|----------|
| **Microphone** | Opus mono at **64 kbps** by default (up to 128 kbps), **RED** (redundant audio) on, in-band FEC on, DTX off (avoids clipped word starts). Echo cancellation (AEC3) on. Chromium's built-in noise suppression is **off** while DeepFilterNet is on. |
| **Noise suppression** | **DeepFilterNet** compiled to WASM, running in an `AudioWorklet` as a LiveKit track processor. It can be toggled per user. RNNoise is the fallback on weak CPUs (T7). |
| **Camera** | Up to 720p30, **simulcast** in 3 layers. LiveKit's adaptive stream and dynacast send each viewer only the layer they need. |
| **Screen share** | Up to **1080p60**, ~6–8 Mbps, `contentHint` set per use (motion for games and video, detail for text). Several simultaneous shares; each viewer picks what to watch (A14). |
| **Screen-share audio** | Stereo Opus at ~128 kbps, with no echo cancellation, noise suppression, or gain control. Both OSes use Electron's `setDisplayMediaRequestHandler` with `audio: 'loopback'`. Windows uses Chromium's WASAPI loopback. **macOS 14.2+ uses Apple's Core Audio Tap API**, which Chromium uses by default as of Electron 39; the app's `Info.plist` must include `NSAudioCaptureUsageDescription`, or the audio track is silently dead. To be confirmed end to end by spike S1 (ROADMAP M0). |
| **Per-person volume** | Client-side gain per remote participant (A29). |
| **Voice activation / push-to-talk** | Voice activity detection with adjustable sensitivity; push-to-talk uses a global shortcut (A37). |

### 6.3 Server-side awareness

LiveKit **webhooks** (`participant_joined`, `participant_left`, `track_published`, …) go to the `hangouts` module. The module:
- keeps the live "who is in which room" state that the sidebar and member list show (A21, A36);
- sends **"hangout started"** notifications when a room goes from empty to occupied (A28);
- marks screen shares as live, which drives the "CANLI" badges.

### 6.4 Nudges (A13, A19)

`POST /nudges { toUserId, roomId }`:
- the recipient must not be in Busy mode;
- there is a cooldown of 60 s per (sender, recipient) pair;
- delivery is an ephemeral WebSocket event. The client shows a prominent notification that joins the room when clicked.

---

## 7. Files and link previews

- **Upload:** a streaming multipart `POST /files`. The server enforces the 100 MB limit (A26) while streaming, computes the SHA-256, writes to storage, and queues thumbnail generation. Originals are never modified.
- **Storage** sits behind a `BlobStore` interface: the local disk now, with S3-compatible object storage possible later without code changes (T6).
- **Download:** `GET /files/:id` (and `/thumb`) with a short-lived **signed URL**, an HMAC over file id, user, and expiry. Plain `<img>` and `<video>` tags work without exposing the access token.
- **Voice messages** are recorded in the client as Opus in WebM and uploaded as `kind = 'voice'` (A22).
- **Link previews** (A24) are fetched by a server job with **SSRF protection**: private, loopback, and link-local IP ranges are blocked after DNS resolution; redirects are capped; there are size and time limits; only HTML `og:`/`twitter:` metadata is parsed. The preview image is downloaded into our own storage. Results are cached per URL.

---

## 8. Events and reminders (A15, A16, A17)

- Recurrence is stored as an **RFC 5545 RRULE** (via the `rrule` library) anchored in `Europe/Istanbul`. Exceptions (skipped or moved occurrences) live in their own table.
- Occurrences are expanded on read for a time window. They are never stored.
- After every event change, the scheduler computes the next reminder time (`occurrence_start − reminder_offset_min`) and enqueues a job. When the job fires, it sends the reminder to online invitees and schedules the next one.
- RSVPs are per occurrence, so "can't make it this Monday" doesn't affect next Monday.
- **Limitation:** on desktop, a reminder only arrives if the app is running. Tray mode and launch at startup (A38, A39) make that the normal case. Mobile push comes with A5.

---

## 9. Authentication and sessions (A20, A25)

| Item | Design |
|------|--------|
| Invite | An admin creates a single-use, expiring invite link carrying a random 256-bit token. Only its hash is stored. |
| Sign-up | Through the invite: choose username, display name, avatar, and password. Minimum length 10 characters, no composition rules. The password is checked against a local list of common passwords. |
| Passwords | Argon2id (OWASP-recommended parameters). Sign-in is rate-limited per IP and per account. |
| Access token | Short-lived (15 min) **JWT signed with Ed25519**. Sent on HTTP requests and in the WebSocket `hello`. |
| Refresh token | Opaque random token, **rotated on every use**, stored as a hash. Reusing an old token revokes the whole session family (theft detection). It expires after 180 days unused. |
| Client storage | Encrypted with Electron `safeStorage`, which uses Keychain on macOS and DPAPI on Windows. |
| Recovery | An admin creates a single-use recovery link (A25) that lets the user set a new password. All existing sessions are revoked. |
| Sessions page | Users can see and revoke their own sessions in the profile view (A41). |

---

## 10. Deployment and operations

### 10.1 Topology (A4, A32, A34)

One VPS, located close to Turkey: **4 vCPU, 8 GB RAM, ≥160 GB disk, 1 Gbps** with generous traffic.

`infra/docker-compose.yml` services:

| Service | Notes |
|---------|-------|
| `caddy` | TLS via Let's Encrypt; reverse proxy for the API and WebSocket on 443. |
| `server` | The Hasbihal server. |
| `postgres` | PostgreSQL 17 with a persistent volume. |
| `livekit` | Uses host networking for media. Ports: 7881/tcp, 50000–60000/udp, TURN 3478/udp and 5349/tls. |

**Needed from the owner:** a **domain name** (e.g. `hasbihal.example`, with subdomains for the API and LiveKit/TURN) and a VPS account.

### 10.2 Backups (A31)

- Nightly `pg_dump` plus the file store, sent with **restic** to Backblaze B2. Restic encrypts client-side and deduplicates.
- Retention: 14 daily, 8 weekly, 12 monthly.
- A monthly scripted **restore test** into a scratch container.

### 10.3 Observability

- Structured logs (pino) with rotation. A health endpoint.
- A free external uptime check, plus alerts for low disk space and backup failures (email to the owner).
- No analytics and no telemetry from clients (A7).

### 10.4 CI (🟡)

GitHub Actions:
- On every push: lint, type-check, and unit plus integration tests.
- On a tag: build the `.dmg` (macOS runner) and `.exe` (Windows runner) and attach them to a GitHub Release, which is the download page linked by A33.
- The server image is built and pushed to the GitHub Container Registry. Deployment is `docker compose pull && up -d` on the VPS.

---

## 11. Testing strategy

| Layer | How |
|-------|-----|
| `protocol`, `core` (parsers, sync, formatting, recurrence) | Vitest unit tests, test-first for the sync engine and Markdown parser. |
| Server modules | Vitest integration tests against real PostgreSQL (Testcontainers) and a real LiveKit dev server where needed. |
| Desktop app | Playwright's Electron support for end-to-end flows: invite → sign up → chat → join hangout. |
| Media quality | A manual checklist for each release: noise suppression, echo, 1080p60 share with audio on both OSes, packet-loss behaviour (using a network link conditioner). |
| Internal test period | Technical family members use pre-release builds until the app is stable, then v1.0 ships (A30). |

---

## 12. Open technical questions

- 🟡 **Library choices** marked 🟡 above (Fastify, Kysely, electron-vite, and so on) need confirmation.
- ❓ **Domain name and VPS provider.** Owner to choose (the provider should be close to Turkey).
- ❓ **macOS system audio in screen share.** Research says it's supported natively on macOS 14.2+ in current Electron (no virtual audio driver needed); spike S1 confirms it end to end. This implies a **minimum macOS version of 14.2 (Sonoma)** for share-with-audio. Owner to confirm the family's Macs meet it.
- ❓ **DeepFilterNet CPU cost on older laptops.** Resolved by spike S2. This decides when the app falls back to RNNoise.
