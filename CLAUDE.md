# Manguito CMS — Claude Code Brief

## Project

Self-hosted schema-driven headless CMS. Read `docs/phase-01.md`
for full architecture decisions and rationale before making changes.

## Current phase

Phase 1 — repo scaffold and tooling. No application logic yet.

## Stack

- Monorepo: pnpm workspace + Turborepo + Changesets
- Language: TypeScript strict mode throughout
- API: Hono
- DB: Drizzle ORM + Postgres (Neon for serverless)
- Admin: Vue 3 + Vite + Tailwind + shadcn-vue

## Package names

@bobbykim/manguito-cms-core
@bobbykim/manguito-cms-db
@bobbykim/manguito-cms-api
@bobbykim/manguito-cms-admin

## Coding conventions

- Factory functions over classes for public API
- Functional style preferred — pure functions for data transformations
- Named function declarations for top-level exports, arrow functions for callbacks
- No barrel index.ts files that re-export everything

## Commands

pnpm install # install all packages
pnpm dev # start all watch processes via Turborepo
pnpm test # run all tests
pnpm build # build all packages in dependency order

## What not to do

- Do not add dependencies to @bobbykim/manguito-cms-core beyond Zod
- Do not cross layer boundaries (parser imports nothing from db or api)
- Do not create JavaScript files — TypeScript only
