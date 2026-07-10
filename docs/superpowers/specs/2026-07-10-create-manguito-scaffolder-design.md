# `@bobbykim/create-manguito` — Dedicated Scaffolder — Design

**Date:** 2026-07-10
**Status:** Approved, ready for implementation planning
**Depends on:** the 0.1.2 scaffold-template hotfix (PR #17) being released first.

## Problem

Scaffolding a Manguito CMS project runs through the full CLI:
`npx @bobbykim/manguito-cms-cli init`. Because the CLI also provides `build`/`dev`,
it declares the whole build toolchain (`tsup`, `vite`, `typescript`, `esbuild`) as
runtime dependencies. So a command that only copies template files downloads and
installs ~100 MB+ of tooling first — a slow, heavy first-touch that doesn't match
the `npm create` experience users expect from the ecosystem (`create-vite`,
`create-next-app`, `create-astro`).

## Goal

Extract scaffolding into a dedicated, lightweight package so the first-touch is fast
and idiomatic:

```
npm create @bobbykim/manguito my-app
```

The package installs a single self-contained artifact (its one dependency,
`@inquirer/prompts`, is bundled), pulls no build toolchain, and produces exactly the
project the current `manguito init` produces.

## Non-goals

- No new scaffold features. v1 is **scaffold-only** — prompt, write files, print next
  steps. No dependency auto-install, no package-manager detection, no git init.
- No changes to what the scaffolded project contains (templates move verbatim,
  including the storage-adapter and `@types/node` fixes already in them).
- No shared internal templates package (only one consumer).

## Decisions (locked)

1. **Separation:** templates and scaffolding logic move to the new package; the CLI
   **drops `init` entirely** and no longer ships templates.
2. **Name:** `@bobbykim/create-manguito` → `npm create @bobbykim/manguito my-app`
   (also runnable as `npx @bobbykim/create-manguito my-app`).
3. **v1 behavior:** scaffold-only, identical output to today's `init`.

## Approach

Chosen: **clean extraction into a self-contained package** (`@bobbykim/create-manguito`).
Rejected alternatives: a shared internal templates package (YAGNI — one consumer); a
`create-manguito` that shells out to `manguito init` (contradicts the goal — still
pulls the toolchain, and `init` is being removed).

## Deliverables

### 1. New package `packages/create-manguito`

- **`package.json`**
  - `name`: `@bobbykim/create-manguito`
  - `bin`: `{ "create-manguito": "./dist/index.js" }`
  - `files`: `["dist"]`, `type: "module"`, `engines.node: ">=22.0.0"`
  - dependency: `@inquirer/prompts` (the only runtime dep)
  - metadata: `license: "MIT"`, `author`, `homepage`, `repository` (with
    `directory: "packages/create-manguito"`) — matching the other packages
- **`tsup.config.ts`**: `entry: src/index.ts`, ESM, `platform: node`, `bundle: true`,
  `clean: true`, `dts: false`, `@inquirer/prompts` in `noExternal` (bundled so the
  published package is self-contained). Template copy uses the **idempotent fs
  remove-then-copy** (never `cp -r`), same as the CLI hotfix:
  ```ts
  onSuccess: async () => {
    rmSync('dist/templates', { recursive: true, force: true })
    cpSync('src/templates', 'dist/templates', { recursive: true })
  }
  ```
- **`src/index.ts`** — bin entry (shebang `#!/usr/bin/env node`): read optional
  `[name]` argv, run prompts (`@inquirer/prompts`), call `scaffold()`.
- **`src/scaffold.ts`** — the pure scaffolding logic, moved from the CLI:
  `TEMPLATES_DIR` resolution, `walkTemplates`, `renderTemplate`, the
  `STORAGE_ADAPTERS` table (import / factory / env per adapter), the non-empty-dir
  guard, template rendering, and the `schemas/paragraph-types/.gitkeep` creation.
  Exposes a `scaffold(name, { prompt, targetDir })`-style function so it is unit
  testable without a TTY (mirrors today's `runInit`).
- **`src/templates/`** — moved verbatim from `packages/cli/src/templates/`.

### 2. Behavior

`npm create @bobbykim/manguito [name]`:
1. Prompt for project name (default: the `[name]` arg) and storage adapter
   (Local filesystem / Amazon S3 / Cloudinary).
2. Guard: refuse to write into a non-empty target directory (guided error).
3. Render every `*.template` file into the target (stripping `.template`),
   substituting `projectName`, `storageImport`, `storageAdapter`, `storageEnv`.
4. Create `schemas/paragraph-types/.gitkeep`.
5. Print next steps: `cd <name>`, `cp .env.example .env` (fill `DB_URL` +
   `AUTH_SECRET`), `pnpm install`, `pnpm dev`.

Output is byte-for-byte what `manguito init` produces today.

### 3. CLI changes (`@bobbykim/manguito-cms-cli`, breaking → `0.2.0`)

- Remove `src/commands/init.ts`, `src/templates/`, `tests/init.test.ts`, and the
  `registerInit(program)` call in `src/index.ts`.
- Remove the template-copy step from the CLI's `tsup.config.ts` (no templates to
  ship anymore).
- Keep `@inquirer/prompts` (still used by `createsuperuser`/`users`).
- Remaining commands: `dev`, `build`, `start`, `migrate`, `migrate:status`,
  `validate`, `createsuperuser`, `users:promote`, `users:demote`.
- Removing `manguito init` is a breaking change → CLI `0.2.0` (pre-1.0 minor).

### 4. Documentation

- Root `README.md` **Quick Start**: `npx @bobbykim/manguito-cms-cli init` →
  `npm create @bobbykim/manguito my-app`.
- `README.md.template` (scaffolded project): getting-started references the new
  command where relevant; the CLI is still the in-project tool (`pnpm dev`, etc.).
- Root `README.md` **CLI Reference** and **Packages** table: drop `init` from the
  CLI's command list; add `@bobbykim/create-manguito` to the packages table.
- `RELEASE.md`: add `@bobbykim/create-manguito` to the published-packages list.

### 5. Testing

Port `packages/cli/tests/init.test.ts` → `packages/create-manguito/tests/scaffold.test.ts`,
against the new `scaffold()` function:
- writes all expected files at the correct root paths; strips `.template`;
- non-empty-dir guard writes nothing;
- per-adapter (Local/S3/Cloudinary): the config emits the real
  `createXAdapter(` call, imports only the chosen adapter, and `.env.example`
  carries the matching variables;
- no unrendered `{{placeholders}}` remain;
- scaffolded `package.json` includes `@types/node`.

Plus a package-level check that the built `dist/templates` is a flat mirror of
`src/templates` (guards against a regression of the 0.1.1 nesting bug).

### 6. Versioning & release

- `@bobbykim/create-manguito` starts at `0.1.0` (initial changeset, `minor`/initial).
- `@bobbykim/manguito-cms-cli` → `0.2.0` (breaking: `init` removed).
- One coordinated changeset. Lands and releases **after** the 0.1.2 CLI hotfix.

## Acceptance criteria

- `npm create @bobbykim/manguito my-app` scaffolds a correct, compilable project and
  installs only the scaffolder (no `tsup`/`vite`/`typescript` pulled at create time).
- The scaffolded project is identical to today's `manguito init` output.
- `manguito init` no longer exists; the rest of the CLI is unchanged.
- New `scaffold.test.ts` passes with the same coverage `init.test.ts` had; the built
  `dist/templates` is flat.
- README/RELEASE docs reflect the new command and package.

## Verified-against-source references

| Fact | Source |
| --- | --- |
| Current scaffold logic to move | `packages/cli/src/commands/init.ts` (`runInit`, `walkTemplates`, `STORAGE_ADAPTERS`) |
| Template renderer to move | `packages/cli/src/utils/template.ts` (`renderTemplate`) |
| Templates to move | `packages/cli/src/templates/**` |
| Existing test coverage to port | `packages/cli/tests/init.test.ts` |
| Idempotent template-copy pattern | 0.1.2 hotfix (PR #17), `packages/cli/tsup.config.ts` |
| Workspace auto-includes `packages/*` | `pnpm-workspace.yaml` |
| Turbo caches `dist/**` (why the copy must be idempotent) | `turbo.json` |
