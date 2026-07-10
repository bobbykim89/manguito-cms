# Manguito CMS

> A self-hosted, developer-first headless CMS where content types are defined as JSON or YAML schemas.

Named after Manguito, a pet bird — and a sibling project to the [Manguito Component Library](https://www.npmjs.com/search?q=%40bobbykim%2Fmanguito).

---

## Table of Contents

- [Why Manguito?](#why-manguito)
- [Approach](#approach)
- [Core Principles](#core-principles)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Defining Content](#defining-content)
- [CLI Reference](#cli-reference)
- [Deployment](#deployment)
- [Auth & Users](#auth--users)
- [Feature Scope](#feature-scope)
- [Architecture Overview](#architecture-overview)
- [Packages](#packages)
- [Phases](#phases)
- [Repository Structure](#repository-structure)
- [Contributing](#contributing)

---

## Why Manguito?

Manguito CMS is a **code-first, self-hosted headless CMS** for developers who want their content model to live in their codebase rather than behind a GUI.

- **Code-first content management.** Content types are plain JSON or YAML files you can version, review, and diff like any other source. The schema is the single source of truth — the database tables, REST API, and admin panel are all generated from it.
- **Serverless-friendly.** Schemas compile to static artifacts at build time, so there's no schema parsing on cold starts. It's built for the burst-at-build, quiet-at-runtime traffic of static-site and JAMstack projects, with a traditional server option when you want one.
- **Minimal and lightweight.** A working CMS runs from a few lines of configuration. The core stays small and dependency-light; advanced features are opt-in rather than bundled in by default.

It's aimed at the space between GUI-driven legacy systems and subscription SaaS platforms: a self-hosted option with a clean, versionable, developer-owned workflow.

---

## Approach

Manguito CMS treats the **schema definition as the single source of truth**. Developers define content types as plain JSON or YAML files. Everything else — the database tables, the REST API, the admin panel forms — is derived automatically from those definitions.

```json
{
  "name": "content--blog_post",
  "label": "Blog Post",
  "type": "content-type",
  "default_base_path": "posts",
  "only_one": false,
  "fields": [
    { "tab": { "name": "content", "label": "Content", "fields": [
      { "name": "blog_title", "label": "Title", "type": "text/plain", "required": true },
      { "name": "blog_body", "label": "Body", "type": "text/rich", "required": true }
    ] } }
  ]
}
```

From this file the system produces:

- A validated Postgres table with correct column types
- REST API endpoints for CRUD operations
- An admin panel form with the correct inputs, validations, and relation pickers

**Getting started is a single command:**

```bash
npx @bobbykim/manguito-cms-cli init my-cms
```

```
  Welcome to Manguito CMS

  ? Database adapter     › Postgres
  ? Storage adapter      › Local (dev only) / S3 / Cloudinary
  ? Deployment target    › Node / AWS Lambda / Vercel

  Creating project in ./my-cms...
  ✓ Scaffolded project structure
  ✓ Generated manguito.config.ts
  ✓ Created example schemas
  ✓ Installed dependencies

  Done! Next steps:
    cd my-cms
    cp .env.example .env
    pnpm dev
```

The user configures the CMS once in `manguito.config.ts` and the CLI handles the rest:

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

```bash
pnpm dev      # start dev server with file watching
pnpm build    # codegen + compile → dist/
pnpm start    # run compiled output (production)
```

---

## Core Principles

**Schema-first.** The JSON/YAML schema file is the canonical definition of a content type. The DB, API, and UI are all derived from it — never the other way around.

**Layer isolation.** The parser knows nothing about the database. The DB module knows nothing about HTTP. The API knows nothing about Vue components. Each layer only communicates with the one directly below it.

**Build-time codegen, not runtime parsing.** In production, schemas are compiled to static TypeScript artifacts at build time. The runtime imports pre-generated code — no schema parsing on cold starts, no per-request overhead.

**Serverless-first.** Designed for the burst-at-build, quiet-at-runtime traffic patterns of SSG projects, with a traditional Node server option available.

**Minimal by default, extensible by design.** A working CMS should be runnable with a few lines of configuration. Advanced features (custom roles, webhooks, multi-language) are addable without touching the core.

---

## Quick Start

```bash
npx @bobbykim/manguito-cms-cli init my-cms
cd my-cms
cp .env.example .env      # fill in DB_URL and AUTH_SECRET
pnpm install
pnpm dev                  # first run auto-migrates, seeds system roles,
                           # and prompts you to create the first admin account
```

Prefer to set up without the dev server (e.g. for production)? Run `pnpm migrate` to create tables and seed roles, then `pnpm exec manguito createsuperuser` to create the admin.

---

## Configuration

Everything lives in a single `manguito.config.ts`, built with `defineConfig`. The config is a set of blocks: `db`, `storage`, `server`, `api`, and `admin` are required (each built from a factory adapter — see the example above); `name`, `schema`, and `migrations` are optional. Most values fall back to environment variables at runtime.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DB_URL` | yes | — | Postgres connection string (`postgres://…`) |
| `AUTH_SECRET` | yes | — | JWT signing secret (required by any token sign/verify path, all environments) |
| `PORT` | no | `3000` | Node server port |
| `NODE_ENV` | no | `development` | Env mode; local storage adapter only warns (does not fail) in `production` |
| `ALLOWED_ORIGIN` | no | `*` | CORS allowed origin |
| `CLOUDINARY_CLOUD_NAME` | if Cloudinary | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | if Cloudinary | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | if Cloudinary | — | Cloudinary API secret |
| `SEEDER_DB_URL` | no | — | Separate DB URL for seeding, if used |

→ See [docs/configuration.md](docs/configuration.md) for the full reference.

---

## Defining Content

Content types live under `schemas/content-types/` as JSON or YAML. Fields are grouped into `tab` wrappers, and every content-type needs a `default_base_path` (matching a `name` in `routes.json`) and an `only_one` flag (`true` for a singleton, `false` for a collection):

```json
{
  "name": "content--blog_post",
  "label": "Blog Post",
  "type": "content-type",
  "default_base_path": "posts",
  "only_one": false,
  "fields": [
    { "tab": { "name": "content", "label": "Content", "fields": [
      { "name": "blog_title", "label": "Title", "type": "text/plain", "required": true },
      { "name": "blog_body", "label": "Body", "type": "text/rich", "required": true }
    ] } }
  ]
}
```

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

Every field also has `name` (snake_case), `label`, and `required`.

→ See [docs/schema-authoring.md](docs/schema-authoring.md) for the full guide.

---

## CLI Reference

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

---

## Deployment

Manguito CMS is built serverless-first: `manguito build` compiles schemas to static artifacts so the runtime never parses schemas on a cold start. It targets AWS Lambda and Vercel for serverless deployment, AWS Fargate for a long-running containerized deployment, and a plain Node server for traditional hosting.

- [docs/deployment/lambda.md](docs/deployment/lambda.md)
- [docs/deployment/fargate.md](docs/deployment/fargate.md)
- [docs/deployment/vercel.md](docs/deployment/vercel.md)

---

## Auth & Users

Auth is JWT-based, signed and verified with the `AUTH_SECRET` environment variable (required in every environment). Every user is assigned one of five system roles:

| Role | Level | Highlights |
| --- | --- | --- |
| `admin` | 0 | Full permissions incl. `users:*`, `roles:read` |
| `manager` | 1 | Content/media/taxonomy CRUD + `users:read` |
| `editor` | 2 | Content/media/taxonomy CRUD |
| `writer` | 3 | `content:read/create`, `media:read/create` |
| `viewer` | 4 | `content:read`, `media:read` |

All system roles are fixed (`is_system: true`); custom roles are a v2+ item.

The first admin user is created with `manguito createsuperuser`. Existing users can be promoted to admin with `manguito users:promote --email <email>`, or demoted from admin to a lower role with `manguito users:demote --email <email> --role <role>`.

---

## Feature Scope

### Included in v1

- `manguito init` CLI with interactive project scaffolding
- JSON and YAML schema parser with Zod validation
- `defineConfig` — single config file, mode inferred from CLI command
- Build-time codegen: schemas → static Drizzle + Hono + Vue artifacts
- Field types: plain text, rich text, integer, float, boolean, date, image/video/file, enum, paragraph, reference
- Relationship types: one-to-one, one-to-many, many-to-many
- Postgres support via Drizzle ORM with programmatic migrations
- REST API with auto-generated CRUD endpoints per content type
- Role-based auth: admin, manager, editor, writer, viewer
- Storage adapters: local filesystem, AWS S3, Cloudinary
- Minimalist admin panel (Vue 3 + Tailwind)
- Serverless deployment targets (AWS Lambda, Vercel), containerized (Fargate), and traditional Node server mode
- Unit and integration test suite

### Planned for v2+

- GraphQL API option
- MongoDB adapter
- Schema versioning with multi-version API routes
- Draft / publish workflow
- Webhooks on content change
- Multi-language / i18n support
- Custom role definitions
- Plugin / extension system
- Azure Blob and GCP Storage adapters

---

## Architecture Overview

```
manguito.config.ts
        │
        ▼
   Manguito CLI              (@bobbykim/manguito-cms-cli)
   (dev / build / start)
        │
        ▼
  Schema Parser              (@bobbykim/manguito-cms-core)
  + Field Type Registry
  + defineConfig
        │
   ┌────┴──────────────┐
   ▼                   ▼
DB Module           API Layer       (@bobbykim/manguito-cms-db/api)
(Drizzle codegen)   (Hono routes)
   │                   │
   ▼                   ▼
Postgres           Admin Panel      (@bobbykim/manguito-cms-admin)
                   (Vue 3)
```

**Dev mode** — schemas parsed dynamically at startup, file watching enabled, Vite dev server mounted as middleware.

**Production mode** — `manguito build` compiles schemas to static artifacts in `dist/generated/`. The runtime imports pre-built code with no parse overhead. Lambda cold starts are fast.

```
schemas/           ← human-authored source of truth
    └── content-types/blog-post.json
          ↓  manguito build
dist/generated/    ← never hand-edited
    ├── schema.ts      (Drizzle table definitions)
    ├── routes.ts      (Hono route registrations)
    └── forms.ts       (Vue form component definitions)
```

The **Field Type Registry** is the architectural keystone. Every supported field type registers three things simultaneously: a Drizzle column definition, an API serialization shape, and a Vue form component. All three are always in sync because they derive from the same registry entry.

---

## Packages

| Package              | npm                            | Description                                        |
| -------------------- | ------------------------------ | -------------------------------------------------- |
| `manguito-cms-core`  | `@bobbykim/manguito-cms-core`  | Schema parser, field type registry, `defineConfig` |
| `manguito-cms-db`    | `@bobbykim/manguito-cms-db`    | Drizzle module, Postgres adapter, migrations       |
| `manguito-cms-api`   | `@bobbykim/manguito-cms-api`   | Hono app, route generation, storage adapters       |
| `manguito-cms-admin` | `@bobbykim/manguito-cms-admin` | Vue 3 admin panel                                  |
| `manguito-cms-cli`   | `@bobbykim/manguito-cms-cli`   | CLI binary — `manguito` command                    |

---

## Phases

| Phase                         | Focus                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| [Phase 1](./docs/phase-01.md) | Foundation — stack decisions, repo scaffold, tooling          |
| [Phase 2](./docs/phase-02.md) | `defineConfig` shape + schema parser + field type registry    |
| [Phase 3](./docs/phase-03.md) | DB module — Drizzle codegen from schema, migrations           |
| [Phase 4](./docs/phase-04.md) | Migration strategy for schema changes                         |
| [Phase 5](./docs/phase-05.md) | REST API layer — route generation, request/response contracts |
| [Phase 6](./docs/phase-06.md) | Auth module — JWT, roles, route protection                    |
| [Phase 7](./docs/phase-07.md) | Testing — unit, integration, smoke tests                      |
| [Phase 8](./docs/phase-08.md) | Admin panel — Vue 3, auto-generated forms                     |
| [Phase 9](./docs/phase-09.md) | CLI — `init`, `dev`, `build`, `start`, `validate` commands    |
| Phase 10                      | Deployment — Lambda, Neon, CI/CD pipeline (done)               |

---

## Repository Structure

```
manguito-cms/
├── packages/
│   ├── core/        # Schema parser, field type registry, defineConfig
│   ├── db/          # Drizzle module, Postgres adapter, migrations
│   ├── api/         # Hono app, route generation, storage adapters
│   ├── admin/       # Vue 3 admin panel
│   └── cli/         # manguito CLI binary
├── apps/
│   └── sandbox/     # Local test harness — not published
├── docs/
│   ├── phase-01.md
│   └── ...
├── schemas/
│   ├── content-types/
│   ├── paragraph-types/
│   ├── taxonomy-types/
│   └── enum-types/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Contributing

This project is in active early development. If you're interested in collaborating, read through the phase docs in `/docs` to understand where things currently stand before diving in.

Releases are cut with Changesets — see [RELEASE.md](./RELEASE.md) for the step-by-step process.

---

## License

[MIT](./LICENSE.md) © Bobby Kim
