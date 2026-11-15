#!/bin/sh
# One backup (A31): a database dump and the files, encrypted and deduplicated by restic into
# $RESTIC_REPOSITORY. Safe to run by hand: docker compose exec backup backup.sh
set -eu

log() { echo "[backup] $(date -Iseconds) $*"; }

# A fixed path, so every snapshot has the same layout (and restic deduplicates across them).
mkdir -p /work
trap 'rm -f /work/hasbihal.dump' EXIT

log "dumping the database"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file=/work/hasbihal.dump

# The first run makes the repository (encrypted with $RESTIC_PASSWORD).
if ! restic cat config >/dev/null 2>&1; then
  log "creating the repository"
  restic init
fi

log "backing up"
restic backup --host hasbihal --tag nightly /work/hasbihal.dump /data/files

# A week of dailies, two months of weeklies, two years of monthlies.
log "pruning old snapshots"
restic forget --host hasbihal --keep-daily 7 --keep-weekly 8 --keep-monthly 24 --prune

# On Sundays, read back a tenth of the stored data to catch silent corruption early.
if [ "$(date +%u)" = 7 ]; then
  log "checking the repository"
  restic check --read-data-subset=10%
fi

mkdir -p /state
date +%s > /state/last-backup
log "done"
