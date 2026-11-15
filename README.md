# Hasbihal

A private chat, voice, video, and screen-sharing app for family and friends, for macOS and Windows.

- [Product decisions](docs/DECISIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)

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
