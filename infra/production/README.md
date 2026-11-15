# Production runbook

The first deployment (ROADMAP M1 step 9): one VPS running PostgreSQL, the Hasbihal server, LiveKit, and Caddy, which provides automatic TLS. Backups and the remaining hardening come in M6.

Everything here is prepared and checked locally: the server image builds and runs, and `compose.yml` and the `Caddyfile` validate. The steps below are the parts that need the real machine.

## 1. What you need

- **A VPS** close to Turkey, running Ubuntu 24.04. A small one is enough to start: 2 vCPU, 4 GB RAM, 40 GB disk, a public IPv4 address, and generous traffic. Voice and video (M2) will want 4 vCPU and 8 GB (ARCHITECTURE §10.1).
- **A hostname** pointing at it. A free DuckDNS subdomain is enough: sign in at duckdns.org, create e.g. `hasbihal`, and set its IP to the VPS address.

## 2. Prepare the server (once)

Log in as root over SSH, then:

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
```

Allow only what Hasbihal uses:

- SSH;
- web on 80 and 443 (for TLS and the app);
- LiveKit media on 7881/tcp and 50000–60000/udp;
- TURN on 3478/udp.

LiveKit's own port 7880 must stay closed, because it's reached only through Caddy.

```bash
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 7881/tcp && ufw allow 3478/udp && ufw allow 50000:60000/udp && ufw --force enable
```

## 3. Install Hasbihal

The repository is private. Give the VPS read-only access with a deploy key: run `ssh-keygen -t ed25519 -f ~/.ssh/hasbihal -N ''` on the VPS, then add `~/.ssh/hasbihal.pub` on GitHub under the repository's Settings → Deploy keys, without write access. Then clone:

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/hasbihal' git clone git@github.com:OmerYesilkaya/hasbihal.git /opt/hasbihal
```

```bash
cd /opt/hasbihal/infra/production && cp .env.example .env
```

Fill in `.env`:

- `HASBIHAL_HOST`: your hostname.
- `POSTGRES_PASSWORD` and `LIVEKIT_API_SECRET`: each one the output of `openssl rand -base64 32`.
- `AUTH_SIGNING_KEY`: generate it as shown below, and paste it in quotes.

To generate the signing key, already in the one-line form `.env` needs:

```bash
openssl genpkey -algorithm ed25519 | awk 'NF {printf "%s\\n", $0}'
```

Start everything:

```bash
docker compose up -d --build
```

Check it. This should answer `"status":"ok"` (the first TLS certificate can take a minute):

```bash
curl https://$(grep HASBIHAL_HOST .env | cut -d= -f2)/health
```

## 4. The first admin (A52)

```bash
docker compose exec server node src/cli/create-admin-invite.ts
```

It prints a single-use `hasbihal://invite/…` link. Open it on your computer with the Hasbihal app installed, or paste the token on the sign-up screen. From then on, invite the family from within the app.

## 5. The desktop app for this server

The server address is built into the app (A30). Build it once per platform, on that platform:

```bash
MAIN_VITE_SERVER_URL=https://hasbihal.duckdns.org pnpm --filter @hasbihal/desktop package
```

The installers end up in `apps/desktop/release/`. The macOS build needs the "Hasbihal Self-Signed" certificate (A50). Send family members the installer with the install notes from A30.

## Updating

```bash
cd /opt/hasbihal && GIT_SSH_COMMAND='ssh -i ~/.ssh/hasbihal' git pull && cd infra/production && docker compose up -d --build
```

Migrations run when the server starts. Clients that are too old get the "new version" screen (A33).

## Notes

- **Data** lives in Docker volumes: `postgres-data` (everything) and `files` (photos and, later, attachments). Back up both; automated backups come in M6 (A31).
- **TURN over TLS** (port 5349), for very strict networks, needs a certificate and comes in M6.
- **Logs:**

  ```bash
  docker compose logs -f server
  ```
