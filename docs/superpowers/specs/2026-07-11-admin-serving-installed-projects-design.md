# Admin Panel Serving in Installed Projects — Design

**Date:** 2026-07-11
**Status:** Approved, ready for implementation planning
**Scope:** Make `manguito dev` / `manguito build` build the admin panel in installed (non-monorepo) projects, by publishing what Vite needs. No change to the dev/build/start lifecycle.

## Problem

In an installed project (e.g. one scaffolded with `npm create @bobbykim/manguito`), `manguito dev` serves the admin panel as **404**, and `manguito build` cannot build it.

Both commands build the admin by running Vite against `resolveAdminRoot()` — the `@bobbykim/manguito-cms-admin` package directory:

- `dev.ts`: `createViteServer({ root: resolveAdminRoot(cwd), server: { middlewareMode: true }, appType: 'spa' })`
- `build.ts`: `viteBuild({ root: resolveAdminRoot(cwd), base: adminPrefix + '/', define: { __ADMIN_PREFIX__, __API_PREFIX__ } })`

This works in the **monorepo/sandbox**, where `resolveAdminRoot` points to `packages/admin/` (Vite source `index.html` + `src/` present, and the admin's build devDeps installed via the workspace). It fails in an **installed project**, where the published `@bobbykim/manguito-cms-admin` ships **only `dist/`** (`files: ["dist"]`) — no `index.html`, no `src/`, and its build toolchain (`vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`) is in `devDependencies`, so not installed.

The original design ([docs/decisions/phase-09/phase-09-cli-dev-server.md](../../decisions/phase-09/phase-09-cli-dev-server.md), [docs/decisions/phase-08/phase-08-admin-panel.md](../../decisions/phase-08/phase-08-admin-panel.md)) specifies `dev` = live Vite HMR server (`root: './packages/admin'`) and `start` = static serving of `dist/admin`. That decision was written for the monorepo layout and never accounted for installed projects. The fix must preserve that lifecycle while making it work outside the monorepo.

## Goals

1. `manguito dev` runs a live Vite HMR server against the admin source in installed projects (as the decision specifies) — `/admin` serves the panel.
2. `manguito build` builds the admin to `dist/admin`; `manguito start` serves it statically — both unchanged in behavior.
3. Fix is confined to the **`@bobbykim/manguito-cms-admin` package packaging** plus a **vite version alignment**; the CLI's dev/build/start serving logic is unchanged.

## Non-goals

- No change to the dev/build/start command architecture or the admin's runtime data flow (it already fetches schema from `/admin/api/*`).
- No runtime-prefix machinery — prefixes remain build-time (`__ADMIN_PREFIX__`/`__API_PREFIX__`), as today.
- No admin source rewrite.

## Approach (chosen)

Honor the original decision: keep `dev` as a Vite-from-source HMR server. Make it work in installed projects by **publishing the admin's Vite source and promoting its build toolchain to runtime dependencies**, so Vite can build the admin wherever the package is installed.

Rejected alternatives (from brainstorming):
- **Serve a prebuilt admin from `dev`** — collapses `dev` into `start`, contradicting the decision.
- **Runtime-injected prefixes + prebuilt static admin** — larger change (admin reads prefixes at runtime), and still moves `dev` away from live Vite.

## Deliverables

### 1. `@bobbykim/manguito-cms-admin` — publish the Vite source

Change `files` from `["dist"]` to include everything Vite needs to build the app from source, while keeping `dist/` (still the library surface — `createAdminAdapter` and `./codegen`, imported by the CLI/api):

```
files: ["dist", "src", "public", "index.html", "vite.config.ts"]
```

`tsconfig.json` is deliberately **not** published: it `extends ../../tsconfig.base.json` (a monorepo path that won't exist in an installed package), and `viteBuild` does not need it (verified — `vite build` from the admin root succeeds with `tsconfig.json` absent; the admin has no path aliases). The admin's own `build` script runs `vue-tsc` for type-checking, but the CLI calls `viteBuild` directly, which uses esbuild defaults.

Excluded (build/test-only, not needed to `viteBuild` from source): `tests/`, `vitest.config.ts`, `tsup.config.ts`, `tsconfig*.json`, `CONTEXT.md`.

Verification during implementation: `npm pack` the admin and confirm the tarball contains `index.html`, `src/main.ts`, `vite.config.ts`, and that a Vite build from the extracted tarball root succeeds.

### 2. `@bobbykim/manguito-cms-admin` — promote build deps to `dependencies`

Move these from `devDependencies` to `dependencies` so they install in user projects (the admin's `vite.config.ts` imports them, and Vite resolves them relative to the admin package under pnpm's strict layout):

- `vite`
- `@vitejs/plugin-vue`
- `@tailwindcss/vite`
- `tailwindcss`

Stay in `devDependencies` (not needed when the CLI runs `viteBuild` directly): `vue-tsc`, `tsup`, `vitest`, `@vue/test-utils`, `@testing-library/vue`, `jsdom`, `@types/jsdom`, `msw`, `dotenv-cli`, `typescript`.

Already `dependencies` (runtime UI libs, unchanged): `vue`, `vue-router`, `pinia`, `@tiptap/*`, `@vueuse/core`, `@fontsource/*`, `@bobbykim/manguito-cms-core`.

### 3. Align vite version between CLI and admin (vite 8)

The CLI pins `vite ^6`; the admin uses `vite ^8`. The CLI runs `viteBuild`/`createServer` against the admin's config and plugins, so a major-version skew risks plugin/peer breakage. Bump the CLI to **vite 8** to match the admin.

- Update `packages/cli` `vite` dependency to the admin's major (`^8`).
- Verify the CLI's two vite call sites under 8:
  - `dev.ts`: `createViteServer({ root, server: { middlewareMode: true }, appType: 'spa', logLevel: 'warn' })`
  - `build.ts`: `viteBuild({ root, base, build: { outDir, emptyOutDir }, define, logLevel: 'warn' })`
  These APIs are stable across vite 6→8; confirm no option renames and that both still run.

### 4. No CLI serving-logic changes

`dev.ts`, `build.ts`, `start.ts`, and `server-entries.ts` keep their current admin-serving logic. The only CLI change is the vite version bump (#3).

## Acceptance criteria

- A freshly scaffolded project installed with **pnpm** (not the monorepo) runs `manguito dev` and `GET /admin` returns the admin panel (HTTP 200, the SPA — not 404), with Vite HMR active.
- `manguito build` in that project produces `dist/admin/index.html` + assets; `manguito start` serves the panel.
- `npm pack @bobbykim/manguito-cms-admin` includes `index.html`, `src/`, `vite.config.ts`, `public/`, and `dist/` (not `tsconfig.json`).
- The admin's promoted deps (`vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`) appear in `dependencies`.
- CLI and admin resolve the same vite major (8); both vite call sites run without error.
- Sandbox still serves the admin (regression check).
- Accepted tradeoff, documented: installed projects now pull the admin Vite build toolchain.

## Verification plan

1. Unit/build: `pnpm --filter @bobbykim/manguito-cms-admin build` and the CLI build succeed under vite 8.
2. Package: `npm pack` the admin; extract; assert the source files are present; run a Vite build from the extracted root.
3. End-to-end (the real bug): scaffold a fresh project, `pnpm install` (published/packed admin), run `manguito dev` → curl `/admin` → 200 + SPA HTML; run `manguito build` → assert `dist/admin/index.html` exists.
4. Regression: `apps/sandbox` `manguito dev`/`build` still serve the admin.

## Release

- `@bobbykim/manguito-cms-admin` — **minor** (new published files + several `devDependencies` promoted to `dependencies` is a notable packaging/dependency-surface change, even though the public API is unchanged).
- `@bobbykim/manguito-cms-cli` — **patch** (vite version bump only).
- One coordinated changeset.

## Verified-against-source reference

| Fact | Value | Source |
| --- | --- | --- |
| dev builds admin via Vite-from-source | `createViteServer({ root: resolveAdminRoot })` | `packages/cli/src/commands/dev.ts:9,172` |
| build builds admin via Vite | `viteBuild({ root: resolveAdminRoot, define })` | `packages/cli/src/commands/build.ts:5,136` |
| admin publishes only dist | `files: ["dist"]` | `packages/admin/package.json` |
| admin build deps in devDeps | vite ^8, @vitejs/plugin-vue ^6, @tailwindcss/vite ^4, tailwindcss ^4 | `packages/admin/package.json` devDependencies |
| CLI vite version | `^6.4.3` (to bump → ^8) | `packages/cli/package.json` |
| admin is runtime-schema-driven | fetches `/admin/api/config`, `/admin/api/schema` | `packages/admin/src/App.vue:48,91` |
| CSP | `script-src 'self'` (unchanged; no inline scripts introduced) | `packages/api/src/middleware/security-headers.ts:23` |
