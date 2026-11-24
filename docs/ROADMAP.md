# Hasbihal: Roadmap

How we get from nothing to v1.0. Every milestone ends with something the test group (technical family members, A30) can install and use, so feedback starts early. References like (A14) point to [DECISIONS.md](DECISIONS.md). Section numbers like §6 point to [ARCHITECTURE.md](ARCHITECTURE.md).

Each milestone lists its **scope** and its **exit criteria**: what must be true before moving on. Milestones are ordered by dependency and risk, with no dates attached.

## Status (2026-11-16)

Everything below is built and covered by tests. The **exit criteria need real people on real machines**, which code and CI can't stand in for.

| Milestone | Built in    | Still needs                                                                                                                         |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| M0        | PRs #1–#4   | — (done)                                                                                                                            |
| M1        | PRs #5–#12  | The first deployment (a VPS and a hostname), then the owner's test                                                                  |
| M2        | PRs #13–#14 | A call between two computers; DTLN fallback if old PCs need it (T7)                                                                 |
| M3        | PR #15      | Film and game sharing with sound on macOS and Windows; T8 codec policy after the old-PC test                                        |
| M4        | PRs #16–#19 | A real photo dump; HEIC photos from iPhones show as files                                                                           |
| M5        | PR #20      | A real reminder at a real time                                                                                                      |
| M6        | PRs #21–#27 | The VPS deployment and B2 storage, the release secrets, and the "10 minutes from being let in to hangout" test with a family member |

M6's pieces: the admin page (#21), independent e2e tests (#22), notifications, tray, and startup (#23), backups and restore drills (#24), CI-built installers and the install guide (#25), e2e in CI (#26), and the app icon, empty states, and sidebar texture (#27). The remaining decoration ideas in DECISIONS §5 (tile-border dividers, star-shaped badges) wait for the owner's eye.

---

## M0: Foundations and risk spikes

Prove the risky parts before building on them, and set up the skeleton everything else grows in.

**Spikes** (throwaway code, findings recorded in DECISIONS.md):

- **S1: macOS screen share with system audio.** An Electron app that captures a window plus system audio on macOS 14.2+ (Core Audio Tap, `audio: 'loopback'`) and on Windows, and publishes it to a local LiveKit server at 1080p60. Confirm: audio is in sync, nothing is recaptured from our own call (no echo of other participants), the permission prompts are understandable, and permissions survive a rebuild (A30, A50).
- **S2: DeepFilterNet in the browser.** DeepFilterNet (WASM, AudioWorklet) on a microphone track in Electron. Measure CPU use and added latency on the slowest Mac and Windows machines in the family. Decide the threshold for falling back to DTLN (T7).

**Skeleton:**

- pnpm monorepo with `apps/desktop`, `apps/server`, `packages/protocol`, `packages/core`, `packages/config` (§2).
- Lint, format, type-check, and test commands. CI running them on every push (§10.4).
- `infra/compose.dev.yml` for local development: PostgreSQL and LiveKit (with the codec config of T8).
- Electron shell with the security hardening of §4.2 from day one: CSP, sandbox, fuses.
- Design tokens from the Saray palette (A46), light/dark (A35), and the i18n setup with Turkish and English (A18).

**Exit criteria:** S1 and S2 succeeded, or the decisions are updated with what we learned. `pnpm dev` starts the server, database, LiveKit, and an empty desktop window. CI is green.

---

## M1: Accounts and chat

The app becomes useful as a text chat.

- Invites, sign-up, sign-in, long-lived sessions, recovery links (A20, A25; §9). Since replaced by Google sign-in and a list of who may join (A25, revised 2026-11-23).
- Profile view: display name, avatar upload, initials fallback with 8 colors (A40, A41).
- Rooms: create, rename, archive, and delete for admins; everyone sees every room (A8, A11, A12).
- Messages: send, reply, edit ("düzenlendi"), delete ("Bu mesaj silindi."), reactions, @mentions and @everyone, typing indicator (A22).
- Markdown formatting: the subset, spoilers, code blocks with highlighting, safe rendering (A47, A48).
- The real-time gateway with catch-up after reconnects (§5).
- Unread badges per room.
- The three-column layout (A36). The member list shows presence (Available/Away/Busy/Offline) (A21).
- The version-compatibility screen (A33).

**Build order** (one PR each, every one usable or testable on its own):

1. **Database foundations:** Kysely, migrations, UUIDv7, Testcontainers for integration tests, the error format.
2. **Accounts:** the first-admin command (A52), invites, sign-up with the username rules (A53), sign-in, rotating refresh tokens, sessions, recovery links, rate limiting.
3. **Desktop sign-in:** sign-up and sign-in screens, the `hasbihal://` handler (A51), tokens in `safeStorage`.
4. **Authenticated gateway:** `hello` with the access token, `event_log` with `seq`, replay and `resync_required`, presence (§5).
5. **Rooms and messages (server):** rooms, messages with replies, edits, deletes, reactions, mentions, typing, unread state.
6. **Chat UI:** the three-column layout, the virtualized message list, the composer, safe Markdown rendering (A47, A48), the member list with presence, unread badges.
7. **Profiles and files:** file storage (A54), avatar upload with the initials fallback, the profile view and the sessions list.

**Exit criteria:** the test group uses Hasbihal for daily text chat for a week. Messages never get lost or duplicated across disconnects, sleep/wake cycles, or two devices per person.

---

## M2: Hangouts (voice and video)

The core experience.

- Join and leave a room's hangout, with LiveKit tokens issued by our server (§6.1).
- High-quality voice settings: Opus, RED, FEC, AEC (A29; §6.2).
- DeepFilterNet noise suppression with a toggle, and the DTLN fallback (T7).
- Camera with simulcast, and the Meet/Discord-style video grid with active-speaker highlighting (§5 of DECISIONS).
- Mute, deafen, per-person volume, voice activation sensitivity, push-to-talk, and global shortcuts (A37).
- Live "who is in which room" in the sidebar and member list, from LiveKit webhooks (§6.3).
- Nudges with cooldown and Busy-mode suppression (A13, A19).
- "Hangout started" notifications (A28).

**Exit criteria:** 10 people in one hangout with cameras on for an hour without degrading (A34). Voice quality is judged at least as good as Discord in a side-by-side test with the same people and headsets. The app recovers from a Wi-Fi drop without anyone having to rejoin by hand.

---

## M3: Screen sharing

- Share a screen or window at up to 1080p60, with system audio on macOS and Windows (A14), using what S1 proved.
- Several simultaneous shares, each in its own grid tile. Viewers pick what to watch, and can enlarge it to fill the hangout area.
- A "CANLI" (live) indicator in the sidebar and member list.
- Quality presets: motion (games, video) and detail (text, code).

**Exit criteria:** watching a film together and watching someone play a game both look smooth and sound right on both OSes.

---

## M4: Files, media, and search

- File upload up to 100 MB with streaming, thumbnails, the inline image/video viewer, download cards for other files, and GIFs rendered inline (A23, A26).
- Voice messages (A22).
- Server-side link previews with SSRF protection (A24; §7).
- Full-text search across all rooms, Turkish-aware (A27; §3.5).

**Exit criteria:** a family photo dump (50+ photos and a few videos) uploads and browses smoothly. Search finds "çay" when you type "cay", and the reverse.

---

## M5: Events

- One-off and recurring events in a room, created by admins (A15, A16).
- Invitees, a configurable reminder (default 10 minutes), RSVPs per occurrence.
- Skipping or moving a single occurrence.
- The event chip in the room header and the room list.

**Exit criteria:** the Monday "Ders" event runs for three weeks, including one skipped and one moved occurrence, with reminders arriving on time for every invitee.

---

## M6: Polish and v1.0

- Notification preferences per room, Busy mode, sounds (A28).
- Tray/menu bar behaviour and launch at startup (A38, A39).
- The admin page: who may join (Google addresses and requests), members, admin rights, rooms (A44).
- The visual identity pass: Ottoman decorative details, the logo, empty states (A45, §5 of DECISIONS).
- Unsigned installers for macOS and Windows, built by CI, with install instructions for the "Open Anyway" and SmartScreen steps (A30).
- Production deployment on the VPS: domain, TLS, firewall, LiveKit TURN (§10.1).
- Nightly encrypted backups and a tested restore (A31).

**Exit criteria:** a fresh family member can go from being let in to talking in a hangout in under 10 minutes, with nothing but the written instructions. A restore drill brings the system back from backup. After that comes the **v1.0 release**.

---

## Later (after v1.0)

- Anything the family asks for once they live with it.
