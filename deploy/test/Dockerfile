FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
RUN npm install --global pnpm@12.14.0
WORKDIR /workspace
RUN chown node:node /workspace
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json
COPY --chown=node:node packages/db/package.json packages/db/package.json
USER node
RUN pnpm install --frozen-lockfile
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN node node_modules/@playwright/test/cli.js install --with-deps chromium
COPY --chown=node:node . .
USER node
RUN mkdir -p .local/testing
CMD ["node", "scripts/test-stack.mjs"]
