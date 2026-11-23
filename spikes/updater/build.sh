#!/bin/sh
# Builds the spike app at the given version into release/<version>.
# Usage: ./build.sh 0.0.1 && ./build.sh 0.0.2
set -eu
version=${1:?version}
cd "$(dirname "$0")"
exec pnpm exec electron-builder --config electron-builder.yml --publish never \
  -c.extraMetadata.version="$version" -c.directories.output="release/$version"
