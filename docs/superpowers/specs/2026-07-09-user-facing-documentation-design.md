# User-Facing Documentation — Design

**Date:** 2026-07-09
**Status:** Approved, ready for implementation planning
**Scope:** Documentation for the initial (MVP) release, plus low-risk template drift fixes.

## Problem

Manguito CMS is feature-complete through Phase 10 and ready for an initial release, but its
documentation has drifted from the code. The root `README.md` reads as a project pitch and
architecture narrative rather than user documentation, and several of its concrete examples are
now factually wrong. The CLI's scaffolded `README.md.template` is thin and slightly stale. New
users have no accurate, end-to-end "how do I configure and operate this" reference.

### Documented drift (verified against source)

- **CLI commands:** README lists 7; the CLI ships 10. Missing: `createsuperuser`,
  `users:promote`, `users:demote` (and `migrate:status` is present but underdocumented).
  Source: `packages/cli/src/commands/*.ts`.
- **Roles:** README says *Admin, Editor, Writer, Tester*. Actual system roles are
  **admin, manager, editor, writer, viewer** with `hierarchy_level` + permission lists.
  "Tester" does not exist. Source: `packages/cli/src/templates/schemas/roles.json.template`.
- **Schema shape:** README's example uses a flat `{ "name": "blog-post", "fields": { "title": {...} } }`.
  Real content-type schemas use `type` / `label` / `fields[]` (an array), optional `tab` grouping,
  and prefixed names (`content--blog_post`, `taxonomy--tag`).
  Source: `packages/cli/src/templates/schemas/content-types/blog-post.json.template`.
- **Field types:** README undercounts. Registry defines 12: `text/plain`, `text/rich`, `integer`,
  `float`, `boolean`, `date`, `image`, `video`, `file`, `enum`, `paragraph`, `reference`.
  Source: `packages/core/src/registry/types.ts`.
- **Config shape:** README's example config is inaccurate — it shows `db: { adapter, url }` and
  `api.cors`, but the real shape has `db` as the adapter itself, `cors` on the **server** adapter,
  a required `server` block, and `api` carrying `rateLimit` / `media`. There is also a new
  `enum_types` schema folder documented nowhere. Source: `packages/core/src/config/types.ts`,
  `packages/cli/src/templates/manguito.config.ts.template`.
- **Deployment targets:** README mentions Lambda + traditional server. Deployment docs exist for
  **Lambda, Fargate, and Vercel** (`docs/deployment/*.md`); server adapter type is `node | lambda | vercel`.

### Code/template inconsistencies (real bugs, to be fixed as template-only changes)

- `.env.example.template` sets `JWT_SECRET`, but the code reads **`AUTH_SECRET`**
  (`packages/api/src/auth/jwt.ts`, `packages/api/src/routes/admin/media.ts`).
- `manguito.config.ts.template` storage comments use `STORAGE_CLOUDINARY_*` env vars and
  `api_key` / `api_secret` option names, but the Cloudinary adapter reads
  `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` and uses option
  names `access_key_id` / `secret_access_key` (`packages/api/src/storage/adapters/cloudinary.ts`).
  The S3 and local adapter option/env names must be verified the same way during implementation.

## Goals

1. Turn the root `README.md` into user documentation while **keeping** the existing pitch and
   architecture narrative (the "keep pitch + add usage" shape the user chose).
2. Move the two heaviest reference topics — configuration and schema authoring — into dedicated
   files under `docs/`, linked from a leaner README.
3. Update `README.md.template` to an accurate, basic per-project usage guide.
4. Fix the low-risk scaffolding-template drift so newly generated projects match the code.
5. Every documented value is verified against source before it is written.

## Non-goals

- No application/runtime code changes. Only documentation and scaffolding **templates** change.
- No deep template-logic changes beyond aligning env-var / option names to what the code reads.
- Not documenting v2+ planned features as if they exist.

## Deliverables

### 1. Root `README.md` (overview + quick-start + operational reference)

Keeps the pitch; adds operational usage; links out for deep reference. Top-to-bottom:

1. Title + tagline + **table of contents** (new TOC)
2. Problem Statement — keep as-is
3. Approach — keep, but **fix the inaccurate schema and config code samples** to real shape
4. Core Principles — keep as-is
5. **Quick Start** (new) — the real "0 to running" path: `npx @bobbykim/manguito-cms-cli init` →
   `cp .env.example .env` (fill `DB_URL` + `AUTH_SECRET`) → `createsuperuser` → `dev`
6. **Configuration** (new, brief) — short overview of the `manguito.config.ts` blocks + the
   environment-variable table, then a link to `docs/configuration.md` for the full reference
   (the README lives at repo root, so links are written as `docs/configuration.md`).
7. **Defining Content** (new, brief) — one correct example schema + the field-type table at a
   glance, then a link: **→ `docs/schema-authoring.md`** for the full guide
8. **CLI Reference** (expanded) — all 10 commands with typical usage:
   `init`, `dev`, `build`, `start`, `validate`, `migrate`, `migrate:status`,
   `createsuperuser`, `users:promote`, `users:demote`
9. **Deployment** (new, brief) — intro + links to `docs/deployment/{lambda,fargate,vercel}.md`;
   correct the "Lambda + traditional server" claim
10. **Auth & Users** (new, brief) — roles table (admin/manager/editor/writer/viewer + hierarchy),
    JWT via `AUTH_SECRET`, first-superuser + promote/demote flow
11. Architecture Overview — keep, minor fixes
12. Packages / Phases / Repository Structure / Contributing — keep; fix the Phase 10 row and add
    `enum_types` to the documented schema folders

### 2. `docs/configuration.md` (new — full configuration reference)

- Anatomy of `manguito.config.ts`, block by block: `name`, `schema` (`base_path`, `folders`),
  `db`, `migrations` (`table`, `folder`), `storage`, `server` (+ `cors`), `api`
  (`prefix`, `rateLimit`, `media`), `admin` (`prefix`).
- Each adapter factory with its **import path** and options, verified against source:
  - `createPostgresAdapter()` — `@bobbykim/manguito-cms-db`
  - `createLocalAdapter` / `createS3Adapter` / `createCloudinaryAdapter` — `@bobbykim/manguito-cms-api/storage`
  - `createServer` / `createAPIAdapter` — `@bobbykim/manguito-cms-api`
  - `createAdminAdapter` — `@bobbykim/manguito-cms-admin`
- **Environment-variable reference:** `DB_URL`, `AUTH_SECRET`, `PORT`, `NODE_ENV`,
  `ALLOWED_ORIGIN`, storage vars (`CLOUDINARY_*`, S3 vars, local upload dir), `SEEDER_DB_URL` —
  each verified against `process.env[...]` reads in source.

### 3. `docs/schema-authoring.md` (new — full authoring guide)

- The four schema folders: `content-types`, `paragraph-types`, `taxonomy-types`, `enum-types`.
- Real schema anatomy: `name` (prefixed convention), `label`, `type`, `fields[]`, optional
  `tab` grouping.
- Field-type reference: all 12 types with their per-type options (limits, accepted MIME types,
  enum refs, reference targets/rel, etc.), verified against `packages/core/src/parser/validators.ts`
  and the registry.
- Relationship types: `one-to-one`, `one-to-many`, `many-to-many`, and the paragraph restriction
  (paragraphs support only `one-to-one` / `one-to-many`).
- `roles.json` (roles, `is_system`, `hierarchy_level`, permissions) and `routes.json` (`base_paths`).

### 4. `README.md.template` (scaffolded per-project guide)

Stays short and accurate — not a mirror of the root docs.

- Getting-started steps verified against the real scaffold: `.env.example` → `.env`, fill
  `DB_URL` **and `AUTH_SECRET`**, `createsuperuser`, `dev`.
- Commands table: keep the 5 npm scripts (`dev`, `build`, `start`, `migrate`, `validate`); add a
  short note on direct `manguito` commands (`createsuperuser`, `users:promote`/`demote`,
  `migrate:status`).
- Project structure: add `enum-types/`, `.env.example`, `migrations/`.
- One pointer to the full docs (repo README).

### 5. Template drift fixes (scaffolding templates only)

- `.env.example.template`: `JWT_SECRET` → **`AUTH_SECRET`**.
- `manguito.config.ts.template`: fix storage-comment env vars (`STORAGE_CLOUDINARY_*` →
  `CLOUDINARY_*`) and Cloudinary option names (`api_key`/`api_secret` → the adapter's actual
  option names) — after verifying each adapter's real option + env names during implementation.
- No logic changes; templates only.

## Approach & guardrails

**Verify-against-source, always.** Because doc drift is the exact failure being corrected, every
env var, role name, field type, adapter factory name/option, and CLI flag is grep-verified against
source before it is written. Anything ambiguous is raised to the user rather than guessed. The
implementation plan will carry a short "verified-against" checklist mapping each documented fact to
its source file.

**Link, don't duplicate.** Deployment content is not copied into the README; it links to the
existing `docs/deployment/*.md`. Configuration and schema-authoring detail live once, in their
dedicated docs, with brief summaries + links in the README.

## Acceptance criteria

- Root `README.md` keeps Problem Statement, Approach, Core Principles, and Architecture, and every
  code sample in them is accurate.
- README documents all 10 CLI commands, the correct 5 roles, and correct deployment targets.
- `docs/configuration.md` and `docs/schema-authoring.md` exist, are linked from the README, and
  every documented value traces to source.
- `README.md.template` matches what `manguito init` actually scaffolds.
- `.env.example.template` and `manguito.config.ts.template` use the env-var and option names the
  code actually reads.
- No non-template source files change.

## Verified-against-source reference (as of writing)

| Fact | Canonical value | Source |
| --- | --- | --- |
| Auth secret env var | `AUTH_SECRET` | `packages/api/src/auth/jwt.ts`, `.../routes/admin/media.ts` |
| Cloudinary env vars | `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` | `packages/api/src/storage/adapters/cloudinary.ts` |
| System roles | admin, manager, editor, writer, viewer | `packages/cli/src/templates/schemas/roles.json.template` |
| Field types (12) | text/plain, text/rich, integer, float, boolean, date, image, video, file, enum, paragraph, reference | `packages/core/src/registry/types.ts` |
| Relationship types | one-to-one, one-to-many, many-to-many (paragraph: no many-to-many) | `packages/core/src/parser/validators.ts` |
| CLI commands (10) | init, dev, build, start, validate, migrate, migrate:status, createsuperuser, users:promote, users:demote | `packages/cli/src/commands/*.ts` |
| Config blocks | name, schema, db, migrations, storage, server(+cors), api(+rateLimit,media), admin | `packages/core/src/config/types.ts` |
| Schema folders (4) | content_types, paragraph_types, taxonomy_types, enum_types | `packages/core/src/config/types.ts` |
| Deployment targets | node, lambda, vercel | `packages/core/src/config/types.ts`, `docs/deployment/*` |
