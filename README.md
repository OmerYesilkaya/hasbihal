# Hasbihal

A private chat, voice, video, and screen-sharing app for family and friends, for macOS and Windows.

- [Product decisions](docs/DECISIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)

## Installing

Download the latest `.dmg` (macOS 14.2+) or `.exe` (Windows 10 22H2+) from
[Releases](https://github.com/OmerYesilkaya/hasbihal/releases/latest). The installers aren't signed
by Apple or Microsoft, so the first launch needs one extra confirmation; the step-by-step guide,
in Turkish, is [docs/KURULUM.md](docs/KURULUM.md). You sign in with Google, once an admin has
added your address (or let you in after you ask). What changed in each version: [CHANGELOG.md](CHANGELOG.md).

Releasing a new version (bump `apps/desktop/package.json`, add its `CHANGELOG.md` section, push a
`v…` tag) is described at the top of `.github/workflows/release.yml`.

## Development

Requirements: Node.js 24+, pnpm 9, and Docker (for PostgreSQL and LiveKit). Packaging the macOS app also needs the
**Hasbihal Self-Signed** code-signing certificate in your Keychain (DECISIONS A50).

```bash
pnpm install
pnpm dev        # starts PostgreSQL + LiveKit (Docker), the server, and the desktop app
pnpm check      # format, lint, type-check, and test
```

### Signing in during development

People sign in with Google (DECISIONS A25), in development too. Use the app's OAuth client (a
**Desktop app** client; `infra/production/README.md`, section 5) or a Google Cloud project of your
own:

1. In `apps/server/.env` (copy `.env.example`), set `GOOGLE_CLIENT_ID`.
2. In `apps/desktop/.env` (copy `.env.example`), set `MAIN_VITE_GOOGLE_CLIENT_ID` and
   `MAIN_VITE_GOOGLE_CLIENT_SECRET`.
3. On a fresh database, let yourself in as the first admin (A52):

   ```bash
   pnpm --filter @hasbihal/server allow-email you@gmail.com --admin
   ```

Everyone else is added on the admin page, or asks to join from the sign-in screen.

### Testing on two computers

To try calls and screen sharing between two computers on the same network, run the server on one
(here a Mac) and only the app on the other. Both computers need this repository, `pnpm install`,
and the app's Google client in `apps/desktop/.env`; only the server computer needs Docker.

On the server computer:

1. Find its address on the network, e.g. `192.168.1.20`: `ipconfig getifaddr en0` (macOS).
2. In `apps/server/.env`, set `HOST=0.0.0.0` so the other computer can reach the server. Also set
   `AUTH_SIGNING_KEY`, in quotes, so restarting the server doesn't sign everyone out. This prints
   it in that one-line form:

   ```bash
   openssl genpkey -algorithm ed25519 | awk 'NF {printf "%s\\n", $0}'
   ```

3. Start everything with the address, so LiveKit announces it instead of `127.0.0.1`:

   ```bash
   HASBIHAL_LAN_IP=192.168.1.20 HASBIHAL_LIVEKIT_URL=ws://192.168.1.20:7880 pnpm dev
   ```

   If macOS asks whether `node` may accept incoming connections, allow it.

4. Let in the Google address you'll sign in with on the other computer: add it on the admin page,
   or run `pnpm --filter @hasbihal/server allow-email <address>`.

On the other computer, start only the app:

```bash
HASBIHAL_SERVER_URL=http://192.168.1.20:8080 HASBIHAL_LIVEKIT_URL=ws://192.168.1.20:7880 pnpm --filter @hasbihal/desktop dev
```

In Windows PowerShell:

```powershell
$env:HASBIHAL_SERVER_URL="http://192.168.1.20:8080"; $env:HASBIHAL_LIVEKIT_URL="ws://192.168.1.20:7880"; pnpm --filter @hasbihal/desktop dev
```

| Path                | What                                              |
| ------------------- | ------------------------------------------------- |
| `apps/desktop`      | Electron + React desktop app                      |
| `apps/server`       | Node server: HTTP API and WebSocket gateway       |
| `packages/protocol` | Wire contract shared by client and server         |
| `packages/core`     | Client logic shared by desktop and (later) mobile |
| `packages/config`   | Shared TypeScript configuration                   |
| `infra`             | Docker Compose for local development              |
| `spikes`            | Throwaway experiments (not part of the product)   |
