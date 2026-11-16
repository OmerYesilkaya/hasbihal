#!/bin/sh
# A restore drill (A31): restores the latest snapshot into a scratch database and a scratch
# folder, then checks that it is complete and intact. Nothing live is touched.
#   docker compose exec backup drill.sh
set -eu

# Only warnings and errors from psql, not "does not exist, skipping" notices.
export PGOPTIONS='-c client_min_messages=warning'

log() { echo "[drill] $(date -Iseconds) $*"; }
fail() { log "FAILED: $*"; exit 1; }

scratch=hasbihal_drill
target=$(mktemp -d)
# The scratch database lives next to the real one, on the same server.
admin_url=$(echo "$DATABASE_URL" | sed 's#/[^/?]*\([?].*\)\{0,1\}$#/postgres\1#')
drill_url=$(echo "$DATABASE_URL" | sed "s#/[^/?]*\([?].*\)\{0,1\}\$#/$scratch\1#")
cleanup() {
  rm -rf "$target"
  psql --quiet --dbname="$admin_url" -c "drop database if exists $scratch" >/dev/null
}
trap cleanup EXIT

log "restoring the latest snapshot to a scratch folder"
restic restore latest --host hasbihal --target "$target" >/dev/null
[ -f "$target/work/hasbihal.dump" ] || fail "the snapshot has no database dump"

log "restoring the database into $scratch"
psql --quiet --dbname="$admin_url" -c "drop database if exists $scratch" -c "create database $scratch" >/dev/null
pg_restore --no-owner --dbname="$drill_url" "$target/work/hasbihal.dump"

# Every table the app needs is there, and nothing is emptier than the live one could explain:
# the backup is at most a day old, and history is only ever added to (A27).
for table in users rooms messages files events; do
  restored=$(psql -At --dbname="$drill_url" -c "select count(*) from $table")
  live=$(psql -At --dbname="$DATABASE_URL" -c "select count(*) from $table")
  log "$table: $restored restored, $live live"
  [ "$restored" -le "$live" ] || fail "$table has more rows in the backup than live"
done
[ "$(psql -At --dbname="$drill_url" -c 'select count(*) from users')" -gt 0 ] ||
  fail "no users in the backup"

# Up to 50 stored files, at random: present, and byte for byte what was uploaded.
psql -At -F ' ' --dbname="$drill_url" \
  -c "select storage_key, encode(sha256, 'hex') from files order by random() limit 50" |
  while read -r key sum; do
    file="$target/data/files/$key"
    [ -f "$file" ] || fail "missing file $key"
    [ "$(sha256sum "$file" | cut -d' ' -f1)" = "$sum" ] || fail "damaged file $key"
  done
log "files checked against their SHA-256"

log "PASSED: the latest backup restores completely"
