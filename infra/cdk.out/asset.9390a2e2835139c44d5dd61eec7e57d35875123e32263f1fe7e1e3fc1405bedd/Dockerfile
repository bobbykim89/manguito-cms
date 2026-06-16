# Builds the apps/sandbox Manguito CMS for container deployment (e.g. Fargate).
#
# Build context MUST be the monorepo root — the sandbox depends on workspace
# packages (packages/*) that need to be resolvable during install and build.
# `manguito build`'s output (dist/server.js) imports those packages directly
# rather than bundling them, so the final image needs a real node_modules with
# them resolved. `pnpm deploy` produces exactly that: a pruned, self-contained
# bundle for a single workspace package.
#
# Usage from repo root:
#   docker build -t manguito-cms-sandbox .

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Build workspace packages in dependency order. Turbo's --filter "sandbox..."
# hits a cycle via test-utils devDependencies, so build packages explicitly.
# A second pnpm install fixes the manguito bin symlink (failed at first install
# because packages/cli/dist/index.js didn't exist yet).
RUN pnpm --filter @bobbykim/manguito-cms-core run build && \
    pnpm --filter @bobbykim/manguito-cms-db run build && \
    pnpm --filter @bobbykim/manguito-cms-api run build && \
    pnpm --filter @bobbykim/manguito-cms-admin run build && \
    pnpm --filter @bobbykim/manguito-cms-cli run build && \
    pnpm install --frozen-lockfile
RUN pnpm --filter sandbox run build

FROM node:22-alpine AS pruned
RUN corepack enable
WORKDIR /repo
COPY --from=builder /repo .
RUN pnpm --filter sandbox deploy --prod /app

FROM node:22-alpine
WORKDIR /app
COPY --from=pruned /app .
COPY --from=builder /repo/apps/sandbox/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
