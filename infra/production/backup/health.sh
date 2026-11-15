#!/bin/sh
# Healthy while the last good backup is under 26 hours old (nightly, with slack). Before the
# first one, healthy for the container's first day (counted from when its PID 1 started).
set -eu
limit=93600
file=/state/last-backup
since=$(stat -c %Y /proc/1)
[ -f "$file" ] && since=$(cat "$file")
[ $(( $(date +%s) - since )) -lt "$limit" ]
