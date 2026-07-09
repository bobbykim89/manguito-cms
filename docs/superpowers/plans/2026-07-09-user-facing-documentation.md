# User-Facing Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the root `README.md` into accurate user documentation (keeping the existing pitch), add two dedicated reference docs, refresh the scaffolded `README.md.template`, and fix low-risk scaffolding-template drift so generated projects match the code.

**Architecture:** Documentation-only plus scaffolding-template edits. No application/runtime source changes. Heavy reference material (configuration, schema authoring) lives in dedicated `docs/*.md` files; the README stays lean and links to them. Every documented fact is copied from a verified source location (see Global Constraints).

**Tech Stack:** Markdown docs; the project's own `manguito.config.ts` (TypeScript) and JSON schema formats; Vitest for the CLI template test.

## Global Constraints

Every documented value below is verified against source as of 2026-07-09. Use these exact values; do not paraphrase from memory. If a value looks wrong during implementation, re-grep the cited source and flag a mismatch rather than guessing.

- **Auth secret env var:** `AUTH_SECRET` — `packages/api/src/auth/jwt.ts:20,30`, `packages/api/src/routes/admin/media.ts:33`
- **DB env var:** `DB_URL` — `packages/db/src/adapters/postgres.ts:4` (must start `postgres://` or `postgresql://`)
- **Other env vars:** `PORT` (default 3000), `NODE_ENV`, `ALLOWED_ORIGIN` (default `*`), `SEEDER_DB_URL` — `packages/api/src/server/node.ts:10,14`, `packages/cli/src/codegen/server-entries.ts:61`
- **Cloudinary env vars:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — `packages/api/src/storage/adapters/cloudinary.ts:42,44,46`
- **System roles (5):** `admin` (level 0), `manager` (1), `editor` (2), `writer` (3), `viewer` (4) — `packages/cli/src/templates/schemas/roles.json.template`
- **Field types (12):** `text/plain`, `text/rich`, `integer`, `float`, `boolean`, `date`, `image`, `video`, `file`, `enum`, `paragraph`, `reference` — `packages/core/src/registry/types.ts`
- **Relationship types:** `one-to-one`, `one-to-many`, `many-to-many`; paragraphs support only `one-to-one`/`one-to-many` — `packages/core/src/parser/validators.ts:142,151`
- **CLI commands (10):** `init`, `dev`, `build`, `start`, `validate`, `migrate`, `migrate:status`, `createsuperuser`, `users:promote`, `users:demote` — `packages/cli/src/commands/*.ts`
- **Config blocks:** `name`, `schema`, `db`, `migrations`, `storage`, `server`, `api`, `admin`; `db`/`storage`/`server`/`api`/`admin` required, `name`/`schema`/`migrations` optional — `packages/core/src/config/types.ts:149-158`
- **Schema folders (4):** `content-types`, `paragraph-types`, `taxonomy-types`, `enum-types` — `packages/core/src/config/types.ts:5-10`
- **Deployment/server targets:** `node`, `lambda`, `vercel`; docs at `docs/deployment/{lambda,fargate,vercel}.md`
- **Naming rule:** No JavaScript files; docs are Markdown, templates keep their existing extensions. Commits follow commitizen conventional-commits (`type(scope): subject`).

---

## Verified reference blocks (shared source content for the tasks)

These blocks are the canonical content the tasks below insert. They are gathered here once (DRY) so the tasks can reference them by name.

### BLOCK A — Adapter factory reference

| Factory | Import path | Options (verified) | Reads env |
| --- | --- | --- | --- |
| `createPostgresAdapter()` | `@bobbykim/manguito-cms-db` | `{ url?, serverless?, pool? { max?, idle_timeout? } }` | `DB_URL` |
| `createLocalAdapter()` | `@bobbykim/manguito-cms-api/storage` | `{ upload_dir? }` (default `./uploads`; throws in `NODE_ENV=production`) | `NODE_ENV` |
| `createS3Adapter()` | `@bobbykim/manguito-cms-api/storage` | `{ bucket, region, prefix?, access_key_id?, secret_access_key? }` | (creds via options or AWS SDK chain) |
| `createCloudinaryAdapter()` | `@bobbykim/manguito-cms-api/storage` | `{ cloud_name?, folder?, access_key_id?, secret_access_key? }` | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| `createServer()` | `@bobbykim/manguito-cms-api` | `{ port?, base_url?, cors? { origin, methods?, credentials?, enabled? } }` | `PORT`, `ALLOWED_ORIGIN` |
| `createAPIAdapter()` | `@bobbykim/manguito-cms-api` | `{ prefix?, media? { max_file_size? }, rateLimit? { findAll? } }` (prefix default `/api`; media default 4 MiB) | — |
| `createAdminAdapter()` | `@bobbykim/manguito-cms-admin` | `{ prefix? }` (default `/admin`) | — |

Source: `packages/db/src/adapters/postgres.ts`, `packages/api/src/storage/adapters/{local,s3,cloudinary}.ts`, `packages/api/src/server/node.ts`, `packages/api/src/index.ts:11-30`, `packages/admin/src/adapters/admin.ts`.

> Note: `access_key_id`/`secret_access_key` are the real S3/Cloudinary option names — NOT `api_key`/`api_secret`.

### BLOCK B — Environment-variable table

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DB_URL` | yes | — | Postgres connection string (`postgres://…`) |
| `AUTH_SECRET` | yes (prod) | — | JWT signing secret |
| `PORT` | no | `3000` | Node server port |
| `NODE_ENV` | no | `development` | Env mode; `production` disables local storage adapter |
| `ALLOWED_ORIGIN` | no | `*` | CORS allowed origin |
| `CLOUDINARY_CLOUD_NAME` | if Cloudinary | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | if Cloudinary | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | if Cloudinary | — | Cloudinary API secret |
| `SEEDER_DB_URL` | no | — | Separate DB URL for seeding, if used |

### BLOCK C — Roles table

| Role | Level | Highlights |
| --- | --- | --- |
| `admin` | 0 | Full permissions incl. `users:*`, `roles:read` |
| `manager` | 1 | Content/media/taxonomy CRUD + `users:read` |
| `editor` | 2 | Content/media/taxonomy CRUD |
| `writer` | 3 | `content:read/create`, `media:read/create` |
| `viewer` | 4 | `content:read`, `media:read` |

All are `is_system: true`. Custom roles are a v2+ item. Source: `packages/cli/src/templates/schemas/roles.json.template`.

### BLOCK D — Field-type table

| Type | Extra options | Notes |
| --- | --- | --- |
| `text/plain` | `limit?`, `pattern?` | Single-line text |
| `text/rich` | — | Rich text |
| `integer` | `min?`, `max?` | Integer value bounds |
| `float` | `min?`, `max?` | Float value bounds |
| `boolean` | — | True/false |
| `date` | — | Date |
| `image` | `max_size?`, `alt?` | Media upload |
| `video` | `max_size?`, `alt?` | Media upload |
| `file` | `max_size?`, `alt?` | Media upload |
| `enum` | `ref?` XOR `values?` | Exactly one of `ref` (standalone enum) or inline `values[]` |
| `paragraph` | `ref`, `rel` (1:1/1:many), `max?` | Embedded paragraph blocks |
| `reference` | `target`, `rel` (1:1/1:many/m:m), `max?` | Reference to content-type/taxonomy-type |

Every field also has `name` (snake_case), `label`, `required`. Source: `packages/core/src/parser/validators.ts:60-153`, `packages/core/src/registry/types.ts`.

### BLOCK E — CLI command table

| Command | Options | Description |
| --- | --- | --- |
| `manguito init [name]` | `--env <path>` | Scaffold a new project interactively |
| `manguito dev` | `--env <path>` | Dev server: file watching + auto-migration |
| `manguito build` | `--env <path>` | Codegen + compile to `dist/` |
| `manguito start` | `--env <path>` | Run production server from `dist/` |
| `manguito validate` | `--env <path>` | Parse & validate schemas, config, roles, routes |
| `manguito migrate` | `--env`, `--status`, `--dry-run`, `--force` | Apply pending migrations |
| `manguito migrate:status` | `--env <path>` | Show migration state (shorthand for `migrate --status`) |
| `manguito createsuperuser` | `--env <path>` | Create the initial admin user |
| `manguito users:promote` | `--env`, `--email <email>` | Promote a user to admin |
| `manguito users:demote` | `--env`, `--email <email>`, `--role <role>` | Demote an admin to a lower role |

Source: `packages/cli/src/commands/*.ts`.

### BLOCK F — Correct config sample (replaces the inaccurate README/Approach sample)

```ts
// manguito.config.ts
import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { createS3Adapter } from '@bobbykim/manguito-cms-api/storage'
import { createServer, createAPIAdapter } from '@bobbykim/manguito-cms-api'
import { createAdminAdapter } from '@bobbykim/manguito-cms-admin'

export default defineConfig({
  name: 'my-cms',
  schema: { base_path: './schemas' },
  db: createPostgresAdapter(),
  migrations: { table: '__manguito_migrations', folder: './migrations' },
  storage: createS3Adapter({
    bucket: process.env['STORAGE_S3_BUCKET']!,
    region: process.env['STORAGE_S3_REGION']!,
  }),
  server: createServer({ cors: { origin: process.env['ALLOWED_ORIGIN'] ?? '*' } }),
  api: createAPIAdapter({ prefix: '/api' }),
  admin: createAdminAdapter({ prefix: '/admin' }),
})
```

### BLOCK G — Correct schema samples

Content-type (tabs REQUIRED — `fields` is an array of `tab` wrappers):

```json
{
  "name": "content--blog_post",
  "label": "Blog Post",
  "type": "content-type",
  "fields": [
    { "tab": { "name": "content", "label": "Content", "fields": [
      { "name": "blog_title", "label": "Title", "type": "text/plain", "required": true },
      { "name": "blog_body", "label": "Body", "type": "text/rich", "required": true }
    ] } }
  ]
}
```

Taxonomy-type and paragraph-type use a FLAT `fields[]` (no tabs). Enum-type has no fields — just `values[]`:

```json
{ "name": "enum--link_target", "label": "Link Target", "type": "enum-type", "values": ["self", "blank"] }
```

Machine-name prefixes: `content--`, `paragraph--`, `taxonomy--`, `enum--` (each `<prefix>--<snake_case>`). Source: `packages/core/src/parser/validators.ts:21-46,126-153,205-225`.

### BLOCK H — routes.json / roles.json shapes

`routes.json`: `{ "base_paths": [ { "name": "posts", "path": "/posts" } ] }`
`roles.json`: `{ "roles": [ { "name, label, is_system, hierarchy_level, permissions[] } ] }`
Source: `packages/cli/src/templates/schemas/{routes,roles}.json.template`.

---

## Task 1: `docs/configuration.md` — full configuration reference

**Files:**
- Create: `docs/configuration.md`

**Interfaces:**
- Produces: a doc at repo-relative path `docs/configuration.md`, linked from the README in Task 3.

- [ ] **Step 1: Write the document**

Create `docs/configuration.md` with these sections, using the verified content blocks verbatim:
1. Intro paragraph — `manguito.config.ts` is the single config file; `defineConfig` from `@bobbykim/manguito-cms-core`.
2. "Full example" — insert **BLOCK F**.
3. "Configuration blocks" — one subsection per block (`name`, `schema` with `base_path`/`folders`, `db`, `migrations` with `table`/`folder`, `storage`, `server` incl. `cors`, `api` incl. `rateLimit`/`media`, `admin`), noting which are required (`db`, `storage`, `server`, `api`, `admin`) vs optional (`name`, `schema`, `migrations`).
4. "Adapters" — insert **BLOCK A** and one short code snippet per storage adapter (local/S3/Cloudinary) using the correct option names.
5. "Environment variables" — insert **BLOCK B**.
6. Cross-links: link back to `README.md` and to `schema-authoring.md`.

- [ ] **Step 2: Verify every documented value against source**

Run each and confirm the doc matches:
```bash
cd /mnt/projects/manguito-cms
grep -n "AUTH_SECRET\|DB_URL\|ALLOWED_ORIGIN\|PORT" packages/api/src/server/node.ts packages/api/src/auth/jwt.ts packages/db/src/adapters/postgres.ts
grep -n "CLOUDINARY_CLOUD_NAME\|access_key_id\|secret_access_key" packages/api/src/storage/adapters/cloudinary.ts
grep -n "prefix\|rateLimit\|media\|max_file_size" packages/api/src/index.ts
```
Expected: every env var, option name, and default in the doc appears in this output. Fix any mismatch in the doc.

- [ ] **Step 3: Verify internal links resolve**

Run:
```bash
cd /mnt/projects/manguito-cms
ls docs/schema-authoring.md README.md 2>&1 || echo "schema-authoring.md not yet created (Task 2) — acceptable if link target planned"
```
Expected: `README.md` exists. `docs/schema-authoring.md` is created in Task 2; the link is still correct.

- [ ] **Step 4: Commit**

```bash
cd /mnt/projects/manguito-cms
git add docs/configuration.md
git commit -m "docs(config): add full configuration reference"
```

---

## Task 2: `docs/schema-authoring.md` — full authoring guide

**Files:**
- Create: `docs/schema-authoring.md`

**Interfaces:**
- Produces: a doc at repo-relative path `docs/schema-authoring.md`, linked from the README in Task 3.

- [ ] **Step 1: Write the document**

Create `docs/schema-authoring.md` with these sections, using the verified content blocks verbatim:
1. Intro — schema is the source of truth; four folders under `schema.base_path` (`content-types`, `paragraph-types`, `taxonomy-types`, `enum-types`).
2. "Schema document types" — explain the four `type` values (`content-type`, `paragraph-type`, `taxonomy-type`, `enum-type`), the machine-name prefixes, and the key structural rule: **content types wrap fields in `tab`s (≥1 required); paragraph and taxonomy types use flat `fields[]`; enum types have `values[]` and no fields**. Insert **BLOCK G**.
3. "Field types" — insert **BLOCK D**, then a short note on the `enum` XOR rule (`ref` vs inline `values`).
4. "Relationships" — `one-to-one`, `one-to-many`, `many-to-many`; `reference` supports all three, `paragraph` only 1:1/1:many; both take `max?`.
5. "Roles" — insert **BLOCK C** and the `roles.json` shape from **BLOCK H**.
6. "Public routes" — the `routes.json` shape from **BLOCK H**.
7. Cross-links: link back to `README.md` and to `configuration.md`.

- [ ] **Step 2: Verify every documented value against source**

Run:
```bash
cd /mnt/projects/manguito-cms
grep -nE "z.literal\('(content-type|paragraph-type|taxonomy-type|enum-type)'\)|RawTabSchema|fields: z.array" packages/core/src/parser/validators.ts
grep -nE "content--|paragraph--|taxonomy--|enum--" packages/core/src/parser/validators.ts
grep -nE "limit|pattern|min|max|max_size|alt|ref|values|target|rel|one-to-one|many-to-many" packages/core/src/parser/validators.ts | head -40
```
Expected: field options, relationship enums, name prefixes, and the tab-vs-flat rule in the doc all appear here. Fix any mismatch.

- [ ] **Step 3: Validate the example schemas actually parse (optional but preferred)**

The example JSON in the doc mirrors `packages/cli/src/templates/schemas/**`. Confirm by diffing shape:
```bash
cd /mnt/projects/manguito-cms
cat packages/cli/src/templates/schemas/content-types/blog-post.json.template | head -20
```
Expected: the doc's content-type example uses the same tab/field structure. Fix if divergent.

- [ ] **Step 4: Commit**

```bash
cd /mnt/projects/manguito-cms
git add docs/schema-authoring.md
git commit -m "docs(schema): add schema authoring guide"
```

---

## Task 3: Root `README.md` — keep pitch, add usage, fix inaccuracies

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/configuration.md` (Task 1), `docs/schema-authoring.md` (Task 2) as link targets.

- [ ] **Step 1: Fix the inaccurate samples in the existing pitch**

In the "Approach" section, replace the flat schema JSON example with the content-type example from **BLOCK G**, and replace the `manguito.config.ts` example with **BLOCK F**. Remove the `api.cors` / `db: { adapter, url }` shape entirely.

- [ ] **Step 2: Add a Table of Contents**

After the tagline/intro, add a Markdown TOC linking to all top-level sections (Problem Statement, Approach, Core Principles, Quick Start, Configuration, Defining Content, CLI Reference, Deployment, Auth & Users, Architecture, Packages, Phases, Repository Structure, Contributing).

- [ ] **Step 3: Add the new usage sections**

Insert, in order after "Core Principles":
- **Quick Start:** `npx @bobbykim/manguito-cms-cli init my-cms` → `cd my-cms` → `cp .env.example .env` (fill `DB_URL` and `AUTH_SECRET`) → `pnpm install` → `pnpm exec manguito createsuperuser` → `pnpm dev`.
- **Configuration (brief):** 3-4 sentences naming the config blocks + insert **BLOCK B** (env table), then `→ See [docs/configuration.md](docs/configuration.md) for the full reference.`
- **Defining Content (brief):** the content-type example from **BLOCK G** + insert **BLOCK D** (field-type table), then `→ See [docs/schema-authoring.md](docs/schema-authoring.md) for the full guide.`
- **CLI Reference:** insert **BLOCK E** (replaces the current 7-command list).
- **Deployment:** one paragraph + links to `docs/deployment/lambda.md`, `docs/deployment/fargate.md`, `docs/deployment/vercel.md`. Remove the "AWS Lambda + traditional server only" framing.
- **Auth & Users:** insert **BLOCK C** (roles) + describe JWT via `AUTH_SECRET`, first superuser via `createsuperuser`, and `users:promote`/`users:demote`.

- [ ] **Step 4: Fix the remaining stale references**

- In "Feature Scope"/"Included in v1": change roles line from "Admin, Editor, Writer, Tester" to the five roles from **BLOCK C**.
- In "Phases": mark Phase 10 (Deployment) done; keep the table.
- In "Repository Structure" and any schema-folder listing: add `enum-types/` alongside content/paragraph/taxonomy.
- Update the init prompt sample (lines ~49-66) so deployment/storage choices match reality (storage: Local / S3 / Cloudinary).

- [ ] **Step 5: Verify links and command list**

Run:
```bash
cd /mnt/projects/manguito-cms
for f in docs/configuration.md docs/schema-authoring.md docs/deployment/lambda.md docs/deployment/fargate.md docs/deployment/vercel.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
grep -c "createsuperuser\|users:promote\|users:demote\|migrate:status" README.md
```
Expected: all link targets `OK`; grep count ≥ 4 (all new commands documented).

- [ ] **Step 6: Commit**

```bash
cd /mnt/projects/manguito-cms
git add README.md
git commit -m "docs(readme): add user guide, fix stale schema/config/role/CLI content"
```

---

## Task 4: `README.md.template` — accurate scaffolded-project guide

**Files:**
- Modify: `packages/cli/src/templates/README.md.template`

- [ ] **Step 1: Update getting-started + commands + structure**

Edit the template so it matches the real scaffold:
- Getting started: `cp .env.example .env`, then "fill in `DB_URL` and `AUTH_SECRET`", `pnpm install`, `pnpm exec manguito createsuperuser`, `pnpm dev`.
- Commands table: keep the 5 npm scripts (`dev`, `build`, `start`, `migrate`, `validate`); add a note: "Other CLI commands: `pnpm exec manguito createsuperuser | users:promote | users:demote | migrate:status`."
- Project structure block: add `enum-types/` under `schemas/`, and add `.env.example` and `migrations/` to the listing.
- Add one line: "Full documentation: https://github.com/bobbykim89/manguito-cms#readme".

- [ ] **Step 2: Verify against the real scaffold inputs**

Run:
```bash
cd /mnt/projects/manguito-cms
grep -n "AUTH_SECRET\|DB_URL" packages/cli/src/templates/.env.example.template
ls packages/cli/src/templates/schemas
grep -c "enum-types\|AUTH_SECRET\|createsuperuser" packages/cli/src/templates/README.md.template
```
Expected: `.env.example.template` shows `AUTH_SECRET` (after Task 5; if Task 5 not yet done, note it); template README grep count ≥ 3.

- [ ] **Step 3: Commit**

```bash
cd /mnt/projects/manguito-cms
git add packages/cli/src/templates/README.md.template
git commit -m "docs(cli): refresh scaffolded README template to match app"
```

---

## Task 5: Template drift fixes (`.env.example.template`, `manguito.config.ts.template`)

**Files:**
- Modify: `packages/cli/src/templates/.env.example.template`
- Modify: `packages/cli/src/templates/manguito.config.ts.template`

- [ ] **Step 1: Fix `.env.example.template`**

Change `JWT_SECRET=change-me-before-going-to-production` to `AUTH_SECRET=change-me-before-going-to-production`. Leave `DB_URL`, `PORT`, `NODE_ENV`, `ALLOWED_ORIGIN`, and the `{{storageAdapter}}` line unchanged.

- [ ] **Step 2: Fix `manguito.config.ts.template` storage comments**

In the storage comment block, change:
- `STORAGE_CLOUDINARY_CLOUD_NAME` → `CLOUDINARY_CLOUD_NAME`
- `STORAGE_CLOUDINARY_API_KEY` → `CLOUDINARY_API_KEY`
- `STORAGE_CLOUDINARY_API_SECRET` → `CLOUDINARY_API_SECRET`
- Cloudinary option names `api_key:` → `access_key_id:` and `api_secret:` → `secret_access_key:`

Leave the S3 comment (`STORAGE_S3_BUCKET`/`STORAGE_S3_REGION`) as-is unless Step 4 shows a mismatch.

- [ ] **Step 3: Verify the fixes match code**

Run:
```bash
cd /mnt/projects/manguito-cms
grep -n "AUTH_SECRET" packages/cli/src/templates/.env.example.template
grep -n "CLOUDINARY_CLOUD_NAME\|access_key_id\|secret_access_key" packages/cli/src/templates/manguito.config.ts.template
grep -n "access_key_id\|secret_access_key\|CLOUDINARY" packages/api/src/storage/adapters/cloudinary.ts
```
Expected: template values now equal the adapter's `process.env[...]` and option names. No `JWT_SECRET` or `STORAGE_CLOUDINARY_` remains in the templates.

- [ ] **Step 4: Run the CLI test suite (no regressions)**

Run:
```bash
cd /mnt/projects/manguito-cms
pnpm --filter @bobbykim/manguito-cms-cli test
```
Expected: PASS. (`template.test.ts` tests `renderTemplate`; these edits don't change placeholders, so it stays green.)

- [ ] **Step 5: Commit**

```bash
cd /mnt/projects/manguito-cms
git add packages/cli/src/templates/.env.example.template packages/cli/src/templates/manguito.config.ts.template
git commit -m "fix(cli): align scaffold env/option names to code (AUTH_SECRET, CLOUDINARY_*)"
```

---

## Out of scope — flag to user (do NOT fix in this plan)

Discovered during planning; outside the approved spec scope. Report these to the user for a follow-up decision:

1. **`{{storageAdapter}}` renders to a bare word.** `packages/cli/src/commands/init.ts:64` maps the storage choice to `'local'` / `'s3'` / `'cloudinary'`, and both `manguito.config.ts.template` (`storage: {{storageAdapter}},`) and `.env.example.template` (`# Storage\n{{storageAdapter}}`) interpolate that bare string. The scaffolded config would read `storage: local,` (an undefined identifier) rather than `storage: createLocalAdapter()`. This looks like a real scaffolding bug needing a code fix in `init.ts` (map to a full factory-call string) — not a docs change.
2. **S3 storage env var names** (`STORAGE_S3_BUCKET` / `STORAGE_S3_REGION`) in the config template comment are not read by the S3 adapter (which takes `bucket`/`region` as options, no env fallback). If env-driven S3 config is intended, the adapter needs an env fallback; otherwise the comment is aspirational. Confirm intent before documenting an env-driven S3 path.

---

## Self-Review

- **Spec coverage:** README overhaul (Task 3) ✓; `docs/configuration.md` (Task 1) ✓; `docs/schema-authoring.md` (Task 2) ✓; `README.md.template` (Task 4) ✓; template drift fixes (Task 5) ✓; verify-against-source guardrail (Global Constraints + per-task Step 2) ✓; link-don't-duplicate for deployment (Task 3 Step 3) ✓. No spec section is unaddressed.
- **Placeholder scan:** All facts are concrete (Blocks A–H carry exact values); no TBD/TODO; verification commands have expected output.
- **Type consistency:** Env var names (`AUTH_SECRET`, `CLOUDINARY_*`), option names (`access_key_id`/`secret_access_key`), role names, field types, and CLI commands are identical across Global Constraints, Blocks, and all tasks.
