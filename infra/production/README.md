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

LiveKit's own port 7880 must stay closed to the internet, because it's reached only through Caddy. The containers still need it: Caddy forwards signaling to it, and the server calls LiveKit's API there. They reach it through Docker's bridge networks (172.16.0.0/12), which ufw would otherwise block, and then joining a voice chat times out.

```bash
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 7881/tcp && ufw allow 3478/udp && ufw allow 50000:60000/udp && ufw allow from 172.16.0.0/12 to any port 7880 proto tcp && ufw --force enable
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
- `POSTGRES_PASSWORD`: the output of `openssl rand -hex 32`. It goes into the database URL, where base64's `/` and `+` would break it.
- `LIVEKIT_API_SECRET`: the output of `openssl rand -base64 32`.
- `AUTH_SIGNING_KEY`: generate it as shown below, and paste it in quotes.
- `RESTIC_PASSWORD`: the output of `openssl rand -base64 32`. It encrypts the backups; **keep a copy in your password manager**, because without it the backups can't be read. Leave `RESTIC_REPOSITORY=/backups` for now (see Backups below).

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

The server address is built into the app (A30), so the installers are made for this server, by GitHub Actions (`.github/workflows/release.yml`):

1. In the repository's **Settings → Secrets and variables → Actions**:
   - add the **variable** `HASBIHAL_SERVER_URL`, e.g. `https://hasbihal.duckdns.org`;
   - add the **secrets** `MAC_CERT_P12` (the "Hasbihal Self-Signed" certificate and key, exported as .p12, then `base64 -i cert.p12 | pbcopy`) and `MAC_CERT_PASSWORD` (A50).
2. Tag the version from `apps/desktop/package.json` and push it:

   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```

3. The workflow builds the macOS `.dmg` and the Windows `.exe` and puts them on a **draft release**, with the install guide (`docs/KURULUM.md`) as its notes. Try both installers, then publish it and send the family the link.

On GitHub's free plan for private repositories, a release uses about 150 of the 2,000 monthly minutes, because macOS minutes count ten times.

## Backups (A31)

The `backup` service backs up the database and all files every night at 03:30 (Istanbul time):

- encrypted with `RESTIC_PASSWORD` and deduplicated, using restic;
- keeps a week of daily backups, two months of weekly ones, and two years of monthly ones;
- on Sundays, reads back a tenth of the stored data to catch corruption early.

**A restore drill** runs on the 1st of every month. It restores the latest backup into a scratch database next to the real one, checks every table and 50 random files against their checksums, and logs `PASSED` or `FAILED`. Nothing live is touched. To see the backups and run either by hand:

```bash
docker compose logs backup
```

```bash
docker compose exec backup backup.sh
```

```bash
docker compose exec backup drill.sh
```

`docker compose ps` shows the service as _unhealthy_ if no backup has succeeded for over 26 hours.

### Off-site storage

`RESTIC_REPOSITORY=/backups` keeps the backups in `infra/production/backups/` **on the same machine**. That protects against mistakes, but not against losing the VPS. For off-site backups (about €1/month at this size), use Backblaze B2:

1. At backblaze.com, create a private bucket (e.g. `hasbihal-yedek`), in the EU region.
2. Create an application key for that bucket only.
3. In `.env`, set the three lines shown in `.env.example` (`RESTIC_REPOSITORY=s3:https://…`, `BACKUP_KEY_ID`, `BACKUP_KEY`). The endpoint is on the bucket's page.
4. Apply the change and take the first backup:

   ```bash
   docker compose up -d backup && docker compose exec backup backup.sh
   ```

### Restoring

On a working server, or a new one set up with this runbook and the same `.env`:

```bash
docker compose stop server
```

```bash
docker compose run --rm backup restore.sh
```

```bash
docker compose start server
```

`restore.sh` restores the latest backup. To pick an older one, list them with `docker compose run --rm backup restic snapshots` and pass the ID: `restore.sh 4f2a9c1e`.

## Updating

A release updates the server by itself: pushing a version tag (`.github/workflows/release.yml`)
builds the installers and, once both have built, runs `deploy.sh` here over SSH. Migrations run
when the server starts. Clients that are too old get the "new version" screen (A33).

To update by hand instead, on the server:

```bash
/opt/hasbihal/infra/production/deploy.sh
```

### One-time setup for automatic updates

The workflow signs in with its own key, which the server lets run `deploy.sh` and nothing else:
no shell, no port forwarding. If the key ever leaks, the worst it can do is redeploy `main`.

1. On your computer, make the key (no passphrase: the workflow can't type one):

   ```bash
   ssh-keygen -t ed25519 -N '' -C hasbihal-deploy -f ~/.ssh/hasbihal-deploy
   ```

2. Give the private half to the workflow, as the `DEPLOY_SSH_KEY` secret:

   ```bash
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/hasbihal-deploy
   ```

3. Let the public half run only `deploy.sh` on the server:

   ```bash
   ssh root@<host> "echo 'command=\"/opt/hasbihal/infra/production/deploy.sh\",restrict $(cat ~/.ssh/hasbihal-deploy.pub)' >> ~/.ssh/authorized_keys"
   ```

4. Delete the private half from your computer; GitHub has it now, and a new one is easy to make:

   ```bash
   rm ~/.ssh/hasbihal-deploy
   ```

The workflow pins the server's SSH host key (`SERVER_HOST_KEY` in `release.yml`), so it only ever
signs in to this server. After moving to a new server, update it there.

## Notes

- **Data** lives in Docker volumes: `postgres-data` (everything) and `files` (photos and attachments). The `backup` service covers both (see Backups).
- **TURN over TLS** (port 5349), for very strict networks, needs a certificate and comes in M6.
- **Logs:**

  ```bash
  docker compose logs -f server
  ```
