# Hasbihal

A private chat, voice, video, and screen-sharing app for family and friends, for macOS and Windows.

- [Product decisions](docs/DECISIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)

## Installing

Download the latest `.dmg` (macOS 14.2+) or `.exe` (Windows 10 22H2+) from
[Releases](https://github.com/OmerYesilkaya/hasbihal/releases/latest). The installers aren't signed
by Apple or Microsoft, so the first launch needs one extra confirmation; the step-by-step guide,
in Turkish, is [docs/KURULUM.md](docs/KURULUM.md). You need an invite link from an admin to sign
up. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

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

| Path                | What                                              |
| ------------------- | ------------------------------------------------- |
| `apps/desktop`      | Electron + React desktop app                      |
| `apps/server`       | Node server: HTTP API and WebSocket gateway       |
| `packages/protocol` | Wire contract shared by client and server         |
| `packages/core`     | Client logic shared by desktop and (later) mobile |
| `packages/config`   | Shared TypeScript configuration                   |
| `infra`             | Docker Compose for local development              |
| `spikes`            | Throwaway experiments (not part of the product)   |
