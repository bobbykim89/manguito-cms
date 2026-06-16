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
# Build CLI and all workspace dependencies before sandbox — turbo resolves the
# correct order (core → db → api → cli, then sandbox).
RUN pnpm exec turbo run build --filter="sandbox..."

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
