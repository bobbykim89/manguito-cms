# Manguito CMS — Claude Code Brief

## Project

Self-hosted schema-driven headless CMS.
Read docs/phase-XX.md before making changes.

## Current phase

Phase 1 — repo scaffold and tooling. No application logic yet.

## Completed phases

(none yet)

## Packages

@bobbykim/manguito-cms-core — schema parser, field type registry, defineConfig
@bobbykim/manguito-cms-db — drizzle module, postgres adapter, migrations
@bobbykim/manguito-cms-api — hono app, route generation, storage adapters
@bobbykim/manguito-cms-admin — vue 3 admin panel
@bobbykim/manguito-cms-cli — manguito CLI binary

## Stack

Monorepo: pnpm workspace + Turborepo + Changesets
Language: TypeScript strict mode, Node 22+
Build: tsup (packages), Vite (admin only)
Test: Vitest throughout
API: Hono + @hono/zod-openapi
DB: Drizzle ORM + Postgres (Neon for serverless)
Admin: Vue 3 + Vite + Tailwind + shadcn-vue
CLI: citty + clack

## Coding conventions

- Factory functions over classes for public API
- Functional style — pure functions for data transformations
- Named function declarations for top-level exports, arrow functions for callbacks
- No barrel index.ts files that re-export everything
- Parser output must be serializable plain objects (no class instances)
- Internal failures use Result type — never throw for expected conditions
- HTTP responses always use { ok, data } / { ok, error: { code, message } } envelope

## Layer boundaries — never cross these

- core → imports nothing from db, api, admin, or cli
- db → imports only from core
- api → imports from core and db
- admin → imports from core
- cli → imports from all

## Commands

pnpm install — install all packages
pnpm dev — start all watch processes via Turborepo
pnpm test — run all tests
pnpm build — build all packages in dependency order

## Do not

- Add dependencies to manguito-cms-core beyond Zod
- Create JavaScript files — TypeScript only
- Import across forbidden layer boundaries
- Throw exceptions for expected failure conditions — use Result type
