FROM node:24-bookworm-slim AS build

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json turbo.json ./
COPY apps/collab/package.json ./apps/collab/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/media-inference/package.json ./apps/media-inference/package.json
COPY apps/media-worker/package.json ./apps/media-worker/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/editor-core/package.json ./packages/editor-core/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci
COPY apps ./apps
COPY packages ./packages
RUN npm run build --workspace @anecites/media-worker
RUN npm prune --omit=dev

FROM node:24-bookworm-slim

ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/media-worker/package.json ./apps/media-worker/package.json
COPY --from=build --chown=node:node /app/apps/media-worker/dist ./apps/media-worker/dist
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=node:node /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=node:node /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist

USER node
CMD ["node", "apps/media-worker/dist/worker.js"]
