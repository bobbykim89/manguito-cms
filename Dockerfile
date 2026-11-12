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
# Build the workspace packages (turbo orders them), then reinstall so the
# manguito bin links to packages/cli/dist, which didn't exist at first install.
RUN pnpm build:packages
RUN pnpm --filter sandbox run build

FROM node:22-alpine AS pruned
RUN corepack enable
WORKDIR /repo
COPY --from=builder /repo .
RUN pnpm --filter sandbox deploy --prod /app

FROM node:22-alpine AS fargate
WORKDIR /app
COPY --from=pruned /app .
COPY --from=builder /repo/apps/sandbox/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]

# Lambda needs the AWS Lambda Runtime Interface Client, which ships in the
# public.ecr.aws/lambda base images — not present in plain node:22-alpine.
# A zip-based Lambda (just dist/ + node_modules) was tried first but the
# pruned node_modules from `pnpm deploy` came out to ~298MB with this pnpm
# version/config (devDependencies aren't fully excluded under
# force-legacy-deploy), over Lambda's 250MB unzipped limit — a container
# image has no such size cap.
FROM public.ecr.aws/lambda/nodejs:22 AS lambda
WORKDIR /var/task
COPY --from=pruned /app .
COPY --from=builder /repo/apps/sandbox/dist ./dist
CMD ["dist/handler.handler"]
