# Manguito CMS — Claude Code Brief

## Project

Self-hosted schema-driven headless CMS.
Read docs/phase-01.md … phase-09.md for v1/MVP context (phase 10 has no doc); for v2 feature work, read the relevant design in docs/v2/ before making changes.
Architectural decisions are recorded as ADRs in docs/adr/ (cross-cutting at the root, per-package in subfolders); see CONTEXT-MAP.md for the package map and per-package CONTEXT.md glossaries.
Before writing a design spec or implementation plan under docs/superpowers/, read docs/superpowers/PLAN-QUALITY.md and run `pnpm lint:plans <file>`.

## Current phase

**v2 — progressive feature delivery.** MVP (v1, phases 1–10) is complete and released. New features are designed as docs in docs/v2/ (e.g. graphql-module.md), each following its own design → plan → implementation cycle.

## Completed phases

Phase 1 — repo scaffold and tooling. No application logic yet.
Phase 2 — implementing schema parser, field type registry, and defineConfig.
Phase 3 — DB module — Drizzle codegen from schema, migrations.
Phase 4 — Migration strategy for schema changes.
Phase 5 — REST API layer — route generation, request/response contracts.
Phase 6 — Auth module — JWT, roles, route protection
Phase 7 — Testing — unit, integration, smoke tests
Phase 8 — Admin panel — Vue 3, auto-generated forms
Phase 9 — CLI — init, dev, build, start, validate commands
Phase 10 — Deployment — Lambda, Neon (publishing to npm stays manual — RELEASE.md)

## Packages

@bobbykim/manguito-cms-core — schema parser, field type registry, defineConfig
@bobbykim/manguito-cms-db — drizzle module, postgres adapter, migrations
@bobbykim/manguito-cms-api — hono app, route generation, storage adapters
@bobbykim/manguito-cms-admin — vue 3 admin panel
@bobbykim/manguito-cms-cli — manguito CLI binary
@bobbykim/create-manguito — `npm create @bobbykim/manguito` project scaffolder
@bobbykim/manguito-cms-test-utils — private shared test fixtures, never published

## Stack

Monorepo: pnpm workspace + Turborepo + Changesets
Language: TypeScript strict mode, Node 22+
Build: tsup (packages), Vite (admin only)
Test: Vitest throughout
API: Hono + @hono/zod-openapi
DB: Drizzle ORM + Postgres (Neon for serverless)
Admin: Vue 3 + Vite + Tailwind (custom components)
CLI: commander + @inquirer/prompts

## Coding conventions

- Factory functions over classes for public API
- Functional style — pure functions for data transformations
- Named function declarations for top-level exports, arrow functions for callbacks
- No barrel index.ts files for internal submodules — each package's root index.ts is its public API surface
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

Scripts live in the root package.json. The non-obvious ones:

- `pnpm test` needs the test database: `pnpm db:test:up` and a `.env.test` copied from `.env.test.example`.
- Build packages with `pnpm turbo run build --filter="./packages/*"` (what CI runs). `pnpm build` also builds apps/sandbox, which needs real storage credentials; `pnpm build:packages` skips create-manguito.
- `pnpm run version` runs `changeset version`; bare `pnpm version` is pnpm's built-in bump and runs nothing.

## Workflow and CI

`master` is protected by a GitHub ruleset with no bypass (docs/adr/0006): every change lands through a pull request whose `ci` check passed.

- Work on a branch (`feat/`, `fix/`, `docs/`, `chore/`, `release/`), then open a PR against master.
- Commit messages are conventional commits: `type(scope): subject`.
- Changes that ship inside a published package carry a changeset (`pnpm changeset`); docs, `.github/` and tooling changes do not.
- Before pushing, run the `ci` steps locally: `pnpm lint`, the filtered build above, `pnpm typecheck`, `pnpm test`, `pnpm smoke`.
- A test that reads a new environment variable needs it declared in turbo.json `passThroughEnv` for the `test` task: Turborepo hides undeclared variables, and `.env.test` masks the omission locally, so it fails only in CI.
- The `ci` job name in .github/workflows/ci.yml is the check .github/rulesets/master.json requires; rename both together, and keep the workflow free of `paths` filters.
- Releases: follow RELEASE.md. `scripts/release-pr.sh` (or the user-invoked `/release-pr` skill) prepares the version-bump PR on a `release/<date>` branch and asks before pushing; publishing then runs from master.

## Do not

- Add dependencies to manguito-cms-core unless they clear a high bar: needed by parsing itself, or a framework-agnostic primitive multiple packages must share identically (current set: zod, yaml, bcryptjs — see docs/adr/core/0006)
- Create JavaScript files — TypeScript only
- Import across forbidden layer boundaries
- Throw exceptions for expected failure conditions — use Result type
