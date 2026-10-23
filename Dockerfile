FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS base
RUN npm install --global pnpm@12.14.0
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS development
COPY --chown=node:node . .
RUN chown -R node:node /workspace \
    && mkdir -p -m 700 /app/private-evidence && chown node:node /app/private-evidence
USER node
CMD ["pnpm", "dev"]

FROM dependencies AS build
COPY . .
RUN pnpm check && pnpm build
RUN pnpm --filter @vtc/api deploy --prod --legacy /out

FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS production
ARG VTC_REVISION=local
LABEL org.opencontainers.image.revision=$VTC_REVISION
ENV NODE_ENV=production SERVE_WEB=true WEB_ROOT=/app/public API_HOST=0.0.0.0 API_PORT=3000
ENV VTC_REVISION=$VTC_REVISION
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
COPY --from=build --chown=node:node /workspace/apps/web/dist/ ./public/
COPY --chown=node:node deploy/development/probe.mjs deploy/development/manual-codec-smoke.mjs deploy/development/manual-native-notices.mjs deploy/development/manual-grants-smoke.mjs deploy/development/trip-decisions-grants-smoke.mjs ./operations/
COPY --chown=node:node third_party/sharp-libvips-1.3.4/ ./third_party/sharp-libvips-1.3.4/
RUN mkdir -m 700 /app/private-evidence && chown node:node /app/private-evidence
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
