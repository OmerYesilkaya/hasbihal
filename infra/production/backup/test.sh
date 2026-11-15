#!/bin/sh
# Tests the backup image end to end, with throwaway containers only: back up a small database
# and its files, pass a restore drill, catch a damaged file, and restore onto a fresh database.
# Run from anywhere: infra/production/backup/test.sh   (needs Docker; used by CI)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
net=hasbihal-backup-test-$$
image=hasbihal-backup:test
cleanup() {
  docker rm -f "$net-pg" "$net-fresh" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
say() { echo "== $*"; }

docker build -q -t "$image" "$here" >/dev/null
docker network create "$net" >/dev/null
start_pg() {
  docker run -d --name "$1" --network "$net" -e POSTGRES_USER=hasbihal -e POSTGRES_PASSWORD=pw \
    -e POSTGRES_DB=hasbihal postgres:17.12-alpine >/dev/null
  until docker exec "$1" pg_isready -U hasbihal -d hasbihal >/dev/null 2>&1; do sleep 0.5; done
  sleep 1
}
start_pg "$net-pg"

# The tables the drill checks, with one file whose checksum matches its bytes.
mkdir -p "$work/files/ab/cd" "$work/repo" "$work/state" "$work/restored"
printf 'Mercimek, soğan, havuç.' > "$work/files/ab/cd/tarif.bin"
sum=$(sha256sum "$work/files/ab/cd/tarif.bin" | cut -d' ' -f1)
docker exec -i "$net-pg" psql -q -U hasbihal -d hasbihal <<SQL
create table users (id int primary key, name text);
create table rooms (id int primary key, name text);
create table messages (id int primary key, body text);
create table files (id int primary key, storage_key text, sha256 bytea);
create table events (id int primary key);
insert into users values (1, 'Ömer');
insert into rooms values (1, 'Salon');
insert into messages values (1, 'Akşam çay var mı?');
insert into files values (1, 'ab/cd/tarif.bin', decode('$sum', 'hex'));
SQL

run() {
  db=$1
  shift
  docker run --rm --network "$net" -e "DATABASE_URL=postgres://hasbihal:pw@$db:5432/hasbihal" \
    -e RESTIC_REPOSITORY=/repo -e RESTIC_PASSWORD=test -v "$work/repo:/repo" \
    -v "$work/state:/state" "$@"
}

say "backup, then a drill that passes"
run "$net-pg" -v "$work/files:/data/files" "$image" backup.sh >/dev/null
run "$net-pg" -v "$work/files:/data/files" "$image" drill.sh | tail -1
run "$net-pg" "$image" health.sh

say "a damaged file makes the drill fail"
cp "$work/files/ab/cd/tarif.bin" "$work/good.bin"
printf 'x' >> "$work/files/ab/cd/tarif.bin"
run "$net-pg" -v "$work/files:/data/files" "$image" backup.sh >/dev/null
if run "$net-pg" -v "$work/files:/data/files" "$image" drill.sh >/dev/null 2>&1; then
  echo "the drill missed a damaged file"
  exit 1
fi
cp "$work/good.bin" "$work/files/ab/cd/tarif.bin"
run "$net-pg" -v "$work/files:/data/files" "$image" backup.sh >/dev/null

say "restore onto a fresh database and an empty folder"
start_pg "$net-fresh"
run "$net-fresh" -v "$work/restored:/data/files" "$image" restore.sh >/dev/null
body=$(docker exec "$net-fresh" psql -At -U hasbihal -d hasbihal -c 'select body from messages')
[ "$body" = 'Akşam çay var mı?' ] || { echo "restored message: $body"; exit 1; }
diff -r "$work/files" "$work/restored" >/dev/null || { echo "restored files differ"; exit 1; }

say "all good"
