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

| Piece               | Role                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop app**     | UI, local state, media capture, and noise suppression. It talks to our server for everything except media, which goes to LiveKit.                                   |
| **Hasbihal server** | The single source of truth: accounts, rooms, messages, files, events, presence, and notification preferences. It issues LiveKit tokens and pushes real-time events. |
| **LiveKit server**  | Relays voice, video, and screen-share media (T5). It holds no persistent data.                                                                                      |
| **PostgreSQL**      | All persistent data except file bytes (T4).                                                                                                                         |

---

## 2. Repository layout (🟡)

One monorepo using **pnpm workspaces**, so every TypeScript package shares types (T3).

```
hasbihal/
├─ apps/
│  ├─ desktop/        Electron main + preload + React renderer (electron-vite)
│  └─ server/         Node server: HTTP API, WebSocket gateway, scheduler, workers
├─ packages/
│  ├─ protocol/       Wire contract: zod schemas, event types, error codes, PROTOCOL_VERSION
│  ├─ core/           Client logic kept apart from the UI: API client, sync engine,
│  │                  stores, Markdown parser, i18n catalogs, formatting helpers
│  └─ config/         Shared tsconfig bases (ESLint and Prettier config live at the repo root)
├─ infra/             docker-compose.yml, Caddyfile, livekit.yaml, backup scripts
└─ docs/
```

Rule: `protocol` depends on nothing internal. `core` depends only on `protocol`. Apps depend on both. The server never imports client code, and clients never import server code.

---

## 3. Server

### 3.1 Stack (🟡)

| Concern                   | Choice                                                              | Why                                                                                    |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| HTTP framework            | **Fastify**                                                         | Fast and mature, with first-class schema validation and a good plugin model.           |
| WebSocket                 | **@fastify/websocket** (`ws`)                                       | Same process and auth path as the HTTP API.                                            |
| Validation                | **zod** schemas from `@hasbihal/protocol`                           | One definition is used on both sides of the wire.                                      |
| Database access           | **Kysely** (typed SQL query builder) with its migrator              | Typed queries without hiding SQL. Full-text search and recursive queries stay natural. |
| Google sign-in            | **jose** (already used for access tokens) checks Google's ID tokens | A25.                                                                                   |
| Images / video thumbnails | **sharp**; **ffmpeg** for video posters                             | A26.                                                                                   |
| Logging                   | **pino** (structured JSON)                                          | Fastify's native logger.                                                               |
| Tests                     | **Vitest** + a real PostgreSQL via Testcontainers                   | Integration tests hit a real database, not mocks.                                      |

### 3.2 Modules

The server is one process (a modular monolith). Each module owns its tables and exposes a service interface. Modules never touch each other's tables directly.

| Module     | Owns                                                         | Notes              |
| ---------- | ------------------------------------------------------------ | ------------------ |
| `auth`     | Google sign-in, sessions, who may join (the list, requests)  | A20, A25           |
| `users`    | profiles, avatars, presence mode, notification prefs         | A21, A28, A40, A41 |
| `rooms`    | rooms, room settings, per-user room prefs                    | A11, A12           |
| `messages` | messages, reactions, mentions, read state, search            | A22, A27, A47      |
| `files`    | uploads, thumbnails, link previews                           | A23, A24, A26      |
| `hangouts` | LiveKit tokens, webhook intake, live room membership, nudges | A6, A13, A14       |
| `events`   | events, recurrence, exceptions, RSVPs, reminder scheduling   | A15, A16           |
| `gateway`  | WebSocket connections, fan-out, presence tracking, replay    | §5                 |
| `admin`    | admin-only operations                                        | A44                |

### 3.3 Data model (🟡 first cut)

All ids are **UUIDv7**: time-ordered, safe to generate on either side, and good for index locality. All timestamps are `timestamptz` (UTC). Display uses Europe/Istanbul (A17).

```
users            id, username (unique, @mention handle), display_name, avatar_file_id?,
                 avatar_color (0–7), role ('admin'|'member'), presence_mode ('available'|'busy'),
                 email? (unique, Google address), google_sub? (unique), created_at, removed_at?
sessions         id, user_id, refresh_token_hash, device_name, created_at,
                 last_used_at, expires_at, revoked_at?
allowed_emails   email, role, added_by?, added_at
access_requests  email, name, requested_at

rooms            id, name, topic?, position, created_by, archived_at?
room_mahrem      room_id, user_id, added_by?, added_at        (A55: the room is Mahrem while it has rows)
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
- `last_read_message_id` drives unread badges only. It is never shown to others (A22: no read receipts). It only moves forward. Without one, "unread" starts when the member joined, so a newcomer isn't greeted by a badge for the whole history.
- **Message order is server time** (`created_at`, then `id`). The id is made by the client so that sends are idempotent, which means its embedded timestamp follows the client's clock and can't be trusted for ordering.

### 3.4 API style

- **Commands go over HTTPS**: `POST /rooms/:id/messages`, `PATCH /messages/:id`, `POST /nudges`, and so on. Each request is validated by its zod schema and returns the created or updated resource.
- **Real-time updates go over one WebSocket** per client (§5). A mutation's HTTP response and its broadcast event carry the same resource, so the sender's UI updates immediately and other clients converge.
- **Sending a message is idempotent:** the client generates the message's UUIDv7 and sends it. A retry after a network blip can't create duplicates.

### 3.5 Search (A27)

- `messages.search_vector` is a generated column: `to_tsvector('simple', hasbihal_fold(body))`, with a GIN index.
- `hasbihal_fold` is an immutable SQL function that folds text the same way as the app's `foldTurkish`:
  - it lower-cases with the **ICU `tr` collation**, so `I→ı` and `İ→i` (a naive lower-case breaks Turkish);
  - it then maps `ı→i`, `ş→s`, `ç→c`, `ğ→g`, `ö→o`, `ü→u`, and drops common accents (`â`, `é`, …).

  It uses `translate()` rather than the `unaccent` extension, whose custom rules would need files on the database server.

- Queries are folded the same way, and **every word matches as a prefix**, all words required. Turkish is suffix-heavy, so `çay` finding _çaylar_ and _çayı_ works better than a stemmer would on folded text.
- Results come **newest first** and page backwards. In a family archive, recency is the best ranking.

### 3.6 Background work

An in-process scheduler backed by the `jobs` table: durable, retried with backoff, and safe across restarts. At our scale there is no need for Redis or a separate worker.

Jobs: thumbnail generation, link-preview fetching, event-reminder dispatch, expired session cleanup, Google profile photos (A25), and orphaned-file garbage collection.

---

## 4. Desktop app

### 4.1 Process model (Electron)

| Process      | Responsibilities                                                                                                                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main**     | Window and tray/menu-bar lifecycle (A38), launch at startup (A39), global shortcuts for mute/deafen/push-to-talk (A37), native notifications, idle detection (`powerMonitor`, A21), secure token storage (`safeStorage`), screen-capture source picking, and the app version reported to the server (A33). |
| **Preload**  | A small typed bridge (`contextBridge`) that exposes only the main-process capabilities above.                                                                                                                                                                                                              |
| **Renderer** | The React UI, `@hasbihal/core`, the LiveKit client, and audio processing.                                                                                                                                                                                                                                  |

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

- **electron-builder** produces an unsigned `.dmg` (universal: Apple Silicon and Intel, signed with the self-signed certificate of DECISIONS A50, not notarized) and an NSIS `.exe` installer.
- Alongside the `.dmg`, a universal `.zip` for updates on macOS, and the update feeds (`latest-mac.yml`, `latest.yml`) and blockmaps on the same GitHub Release.

### 4.5 Updates (A30, A33)

- **electron-updater** reads the published GitHub Releases of the repository. Drafts are invisible to it, so nothing reaches anyone until the owner publishes a release.
- The main process checks at startup and every few hours. When a newer version exists, the renderer shows a banner with an **Update** button: download, install, restart. Nothing installs without the user's click, except that a downloaded update installs when the app quits.
- **macOS:** Squirrel.Mac installs the update after checking that the new bundle satisfies the running app's designated requirement (bundle ID + the A50 certificate), so no Developer ID or notarization is needed (spike S3). An app that runs from the dmg or Downloads is translocated by macOS and can't update itself: the app checks `app.isInApplicationsFolder()` and offers to move itself there (`app.moveToApplicationsFolder()`).
- **Differential downloads:** after the first update (always a full download on macOS), only the changed blocks are downloaded, a few MB instead of ~115 MB (spike S3).
- **Required updates** are the A33 check: the server's minimum supported version. Its screen offers the same **Update** button.
- Builds run in CI on macOS and Windows runners (§9).

---

## 5. Real-time sync

### 5.1 Connection

1. The client opens `wss://<host>/ws` and sends `hello { accessToken, clientVersion, protocolVersion, lastSeq? }`.
2. The server checks the protocol version first. If it doesn't support it, it replies `upgrade_required { minProtocolVersion, maxProtocolVersion }` and closes the connection (A33); the app then offers to update itself (§4.5).
3. Otherwise it replies `welcome { seq, me, … }`, then either replays missed events (§5.3) or tells the client to resync.
4. Heartbeats run every 20 s. The client reconnects with jittered exponential backoff.

### 5.2 Event types

| Durable (stored in `event_log`, replayable)              | Ephemeral (live only)                          |
| -------------------------------------------------------- | ---------------------------------------------- |
| message created / edited / deleted                       | typing started (expires after 6 s)             |
| reaction added / removed                                 | presence changed (online, away, busy, offline) |
| room created / renamed / archived                        | hangout participants changed                   |
| member joined / removed / role changed / profile updated | nudge received                                 |
| event created / changed / cancelled; RSVP changed        | event reminder due                             |

### 5.3 Catch-up after a disconnect

- Every durable event gets a global, monotonically increasing `seq`.
- Events are written in the same transaction as the change they describe, under a transaction-scoped advisory lock, so they **commit in `seq` order**. Without it, seq 6 could commit before seq 5, and a client that saw 6 would never be sent 5. The gateway reads events back from the log in order (one pump), rather than pushing them from the request that wrote them.
- A connecting client joins the live stream first and buffers it while the missed events replay, so it gets no gaps and no duplicates.
- The client remembers the last `seq` it applied. On reconnect it sends `lastSeq`, and the server replays everything newer **if** the gap is still in `event_log`. The log is retained for 30 days, which is plenty at our volume.
- If the gap is too old, the server sends `resync_required`. The client then refetches rooms, members, and recent messages for each room.
- Events are applied idempotently by resource id and version, so seeing an event twice is harmless.

### 5.4 Presence (A21)

- The server counts live WebSocket connections per user. Zero connections means **Çevrimdışı** (offline). Ending a session (sign-out, a revoked device, removal) closes its connections at once.
- The user picks **Müsait** (available) or **Meşgul** (busy). The main process reports system idle time, and after 10 minutes idle the client sends `away`, so the user shows as **Uzakta** (away) until activity resumes.
- "In a hangout" comes from LiveKit webhooks (§6.3), not from the client, so it can't drift.

---

## 6. Hangouts: voice, video, screen share

### 6.1 Joining

1. The client calls `POST /rooms/:id/hangout/token`.
2. The server checks membership and returns a short-lived **LiveKit access token**: room = our room id, identity = our user id, with publish/subscribe grants.
3. The client connects to LiveKit directly. Media never passes through our Node server.

**Mahrem rooms (A55).** A room is Mahrem while `room_mahrem` lists anyone. The token is then only for people on the list, or with a pass:

- `PUT /rooms/:id/mahrem { memberIds }` sets the list (turning it on, or changing it); `DELETE /rooms/:id/mahrem` turns it off. Only people on the list may change it, except that anyone may turn it on with themselves on the list. The room's `mahremMemberIds` reach everyone in `room_updated`; everyone on the old or new list also gets an ephemeral `mahrem_changed` naming who changed what.
- `POST /rooms/:id/mahrem/knock` sends an ephemeral `knock` to everyone on the list who is online (30 s cooldown per person and room). `POST /rooms/:id/mahrem/knocks/:userId { admit }` answers it; `knock_answered` goes to the knocker and the list, so other prompts close. Admitting gives an in-memory pass for one call: it ends when they leave, or after 2 minutes unused.
- After the list changes, and whenever LiveKit reports a join (§6.3), anyone in the call without the right is removed through LiveKit's API, so a token issued earlier can't be used to slip in.

### 6.2 Media settings (A29, A14)

| Track                               | Settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Microphone**                      | Opus mono at **64 kbps** by default (up to 128 kbps), **RED** (redundant audio) on, in-band FEC on, DTX off (avoids clipped word starts). Echo cancellation (AEC3) on. Chromium's built-in noise suppression is **off** while DeepFilterNet is on.                                                                                                                                                                                                                                                                                                                                                                      |
| **Noise suppression**               | **DeepFilterNet** compiled to WASM, running in an `AudioWorklet` as a LiveKit track processor. It can be toggled per user. DTLN (from the same package) is the fallback on weak CPUs (T7).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Camera**                          | Up to 720p30, **simulcast** in 3 layers. LiveKit's adaptive stream and dynacast send each viewer only the layer they need.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Screen share**                    | Up to **1080p60**, ~6–8 Mbps, `contentHint` set per use (motion for games and video, detail for text). Several simultaneous shares; each viewer picks what to watch (A14). The encoding is set explicitly through `screenShareEncoding`; LiveKit's default is 15 fps. **H.264 Baseline** is negotiated so the hardware encoder is used where there is one (T8).                                                                                                                                                                                                                                                         |
| **Screen-share audio**              | Stereo Opus at ~128 kbps, with no echo cancellation, noise suppression, or gain control. Both OSes use Electron's `setDisplayMediaRequestHandler` with `audio: 'loopback'`. Windows uses Chromium's WASAPI loopback. **macOS 14.2+ uses Apple's Core Audio Tap API**, which Chromium uses by default as of Electron 39; the app's `Info.plist` must include `NSAudioCaptureUsageDescription`, or the audio track is silently dead. The capture requests **`restrictOwnAudio`**, so the app's own playback (other participants' voices) isn't captured and echoed back. Both confirmed in spike S1 on macOS and Windows. |
| **Per-person volume**               | Client-side gain per remote participant (A29).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Voice activation / push-to-talk** | Voice activity detection with adjustable sensitivity; push-to-talk uses a global shortcut (A37).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

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
- **Limitation:** on desktop, a reminder only arrives if the app is running. Tray mode and launch at startup (A38, A39) make that the normal case. There is no mobile push (A5: desktop only).

---

## 9. Authentication and sessions (A20, A25)

| Item           | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who may join   | Admins keep a list of Google addresses (A25); the first admin's comes from a server command (`allow-email`, A52). Someone not on the list may send a request, proven with their Google sign-in; online admins get a `access_requested` gateway message, and the admin page lists requests.                                                                                                                                                                                                                                                                                                   |
| Sign-in        | **Sign in with Google** (OpenID Connect). The desktop app opens Google in the system browser and receives the answer on a one-off `127.0.0.1` port, with PKCE (RFC 8252), then sends the ID token to the server. The server checks its signature against Google's keys, its audience (our client id), and that the address is verified; then finds the account by Google's permanent id (`sub`), else by address for members made before Google sign-in (linked then), else makes one if the address is on the list. Name and photo come from Google. Google is asked nothing after sign-in. |
| Access token   | Short-lived (15 min) **JWT signed with Ed25519**. Sent on HTTP requests and in the WebSocket `hello`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Refresh token  | `<sessionId>.<random secret>`, **rotated on every use**; only the secret's hash is stored. Presenting an old secret for a live session means it was copied, so the session is revoked (theft detection). Clients refresh one request at a time. It expires after 180 days unused. Every authenticated request also checks the session row, so sign-out, revocation, and member removal apply at once.                                                                                                                                                                                        |
| Client storage | The **main process owns the session**: it runs the Google sign-in, refreshes, and keeps the refresh token encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows). The renderer only ever receives short-lived access tokens, so a compromised renderer can't take the long-lived session with it.                                                                                                                                                                                                                                                                       |
| Sessions page  | Users can see and revoke their own sessions in the profile view (A41).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 10. Deployment and operations

### 10.1 Topology (A4, A32, A34)

One VPS, located close to Turkey: **4 vCPU, 8 GB RAM, ≥160 GB disk, 1 Gbps** with generous traffic.

`infra/production/compose.yml` services (runbook: `infra/production/README.md`):

| Service    | Notes                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `caddy`    | TLS via Let's Encrypt; reverse proxy for the API and gateway, and for LiveKit signaling at `/livekit`, all on 443. |
| `server`   | The Hasbihal server.                                                                                               |
| `postgres` | PostgreSQL 17 with a persistent volume.                                                                            |
| `livekit`  | Uses host networking for media. Ports: 7881/tcp, 50000–60000/udp, TURN 3478/udp and 5349/tls.                      |

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
- On a tag: build the `.dmg` (macOS runner) and `.exe` (Windows runner) and attach them, with the `.zip`, update feeds, and blockmaps, to a draft GitHub Release. Publishing it makes it the download page and the update every app picks up (§4.5).
- The server image is built and pushed to the GitHub Container Registry. Deployment is `docker compose pull && up -d` on the VPS.

---

## 11. Testing strategy

| Layer                                                      | How                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`, `core` (parsers, sync, formatting, recurrence) | Vitest unit tests, test-first for the sync engine and Markdown parser.                                                                                         |
| Server modules                                             | Vitest integration tests against real PostgreSQL (Testcontainers) and a real LiveKit dev server where needed.                                                  |
| Desktop app                                                | Playwright's Electron support for end-to-end flows: sign in with Google (a stand-in) → chat → join hangout.                                                    |
| Media quality                                              | A manual checklist for each release: noise suppression, echo, 1080p60 share with audio on both OSes, packet-loss behaviour (using a network link conditioner). |
| Internal test period                                       | Technical family members use pre-release builds until the app is stable, then v1.0 ships (A30).                                                                |

---

## 12. Open technical questions

- 🟡 **Library choices** marked 🟡 above (Fastify, Kysely, electron-vite, and so on) need confirmation.
- ❓ **Domain name and VPS provider.** Owner to choose (the provider should be close to Turkey).
