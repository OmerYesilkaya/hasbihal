# The Hasbihal server (ARCHITECTURE §10). Build from the repository root:
#   docker build -f apps/server/Dockerfile -t hasbihal-server .
#
# Node runs the TypeScript sources directly (type stripping), but refuses to do so inside
# node_modules. So the image keeps the pnpm workspace layout, where @hasbihal/core and
# @hasbihal/protocol are symlinks to real source folders, instead of flattening them.
FROM node:24-slim

# ffmpeg reads video sizes and makes poster frames for uploaded videos (ARCHITECTURE §7).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dependencies first, so source changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @hasbihal/server... && pnpm store prune

COPY packages/protocol/src packages/protocol/src
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    FILES_DIR=/data/files
RUN mkdir -p /data/files && chown node:node /data/files
VOLUME /data/files
USER node
WORKDIR /app/apps/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
