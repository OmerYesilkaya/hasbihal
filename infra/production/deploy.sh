#!/usr/bin/env bash
# Updates the server to the latest main and restarts what changed: the same as "Updating" in the
# README. The release workflow runs it over SSH with a key that can run nothing else (the
# `command=` in the server's authorized_keys); run it by hand on the server too, if you like.
#
# The whole script is one function, called on the last line: bash then reads all of it before
# running any, so `git pull` replacing this file mid-run can't make it run half old, half new.
# A change to this script itself takes effect from the next deploy.
set -euo pipefail

main() {
  cd /opt/hasbihal
  echo "Updating from $(git rev-parse --short HEAD)"
  GIT_SSH_COMMAND='ssh -i ~/.ssh/hasbihal' git pull --ff-only
  echo "Now at $(git log -1 --format='%h %s')"

  cd infra/production
  # Migrations run when the server starts (README, "Updating").
  docker compose up -d --build --remove-orphans
  # Old server images pile up with every build.
  docker image prune -f >/dev/null
  docker compose ps
}

main "$@"
exit
