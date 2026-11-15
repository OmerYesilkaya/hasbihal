#!/bin/sh
# Brings Hasbihal back from a backup: the database and the files, as they were in a snapshot.
# Stop the server first (docker compose stop server), then:
#   docker compose run --rm backup restore.sh            # the latest snapshot
#   docker compose run --rm backup restore.sh 4f2a9c1e   # a particular one (restic snapshots)
set -eu

snapshot=${1:-latest}
log() { echo "[restore] $(date -Iseconds) $*"; }

target=$(mktemp -d)
trap 'rm -rf "$target"' EXIT

log "restoring snapshot $snapshot"
restic restore "$snapshot" --host hasbihal --target "$target"

log "restoring the database (this replaces what is there)"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$target/work/hasbihal.dump"

log "restoring the files"
mkdir -p /data/files
cp -a "$target/data/files/." /data/files/

log "done; start the server again: docker compose start server"
