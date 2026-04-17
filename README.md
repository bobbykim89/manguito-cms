# Manguito CMS

> A self-hosted, developer-first headless CMS where content types are defined as JSON or YAML schemas.

Named after Manguito, a pet bird — and a sibling project to the [Manguito Component Library](https://www.npmjs.com/search?q=%40bobbykim%2Fmanguito).

---

## Problem Statement

Teams building modern web products — particularly static site generators and JAMstack applications — face an uncomfortable dilemma when choosing a headless CMS.

**Legacy systems (Drupal, WordPress)** are painful for developers. Creating or updating a content type means navigating multiple admin screens, clicking through GUI wizards, and hoping nothing breaks. Schema changes are slow, error-prone, and impossible to version control meaningfully. Performance is poor.

**Modern SaaS headless CMS platforms (Contentful, Sanity, Prismic)** offer a great developer experience but charge several thousand dollars per month at team scale. For smaller teams or agencies managing multiple projects, this cost is simply prohibitive.

The gap: developer teams that want a **clean, code-first content management workflow** without the overhead of legacy systems or the cost of modern SaaS platforms have no good self-hosted option.

---

## Approach

Manguito CMS treats the **schema definition as the single source of truth**. Developers define content types as plain JSON or YAML files. Everything else — the database tables, the REST API, the admin panel forms — is derived automatically from those definitions.

```json
{
  "name": "blog-post",
  "fields": {
    "title": { "type": "text/plain", "limit": 255 },
    "body": { "type": "text/rich" },
    "cover": { "type": "image" },
    "tags": { "type": "reference", "target": "tag", "rel": "many-to-many" }
  }
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
  ? Deployment target    › Traditional server / AWS Lambda

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
// manguito.config.ts — the only file users need to write
import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { createS3Adapter } from '@bobbykim/manguito-cms-api'

export default defineConfig({
  schema: {
    basePath: './schemas',
  },
  db: {
    adapter: createPostgresAdapter(),
    url: process.env.DB_URL,
  },
  storage: createS3Adapter({
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
  }),
  admin: {
    prefix: '/admin',
  },
  api: {
    prefix: '/api',
    cors: { origin: process.env.ALLOWED_ORIGIN },
  },
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

**Serverless-first.** Designed for the burst-at-build, quiet-at-runtime traffic patterns of SSG projects, with a traditional server option available.

**Minimal by default, extensible by design.** A working CMS should be runnable with a few lines of configuration. Advanced features (custom roles, webhooks, multi-language) are addable without touching the core.

---

## CLI Commands

```bash
manguito init [name]      # scaffold new project interactively
manguito dev              # start dev server, dynamic mode, file watching
manguito build            # codegen + compile → dist/
manguito start            # run dist/ (production traditional server)
manguito migrate          # run pending DB migrations manually
manguito migrate:status   # show migration state
manguito validate         # parse and validate all schemas, report errors
```

---

## Feature Scope

### Included in v1

- `manguito init` CLI with interactive project scaffolding
- JSON and YAML schema parser with Zod validation
- `defineConfig` — single config file, mode inferred from CLI command
- Build-time codegen: schemas → static Drizzle + Hono + Vue artifacts
- Field types: plain text, rich text, integer, float, boolean, date, image/file, reference
- Relationship types: one-to-one, one-to-many, many-to-many
- Postgres support via Drizzle ORM with programmatic migrations
- REST API with auto-generated CRUD endpoints per content type
- Role-based auth: Admin, Editor, Writer, Tester
- Storage adapters: local filesystem, AWS S3, Cloudinary
- Minimalist admin panel (Vue 3 + Tailwind + shadcn-vue)
- Serverless deployment target (AWS Lambda) and traditional server mode
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
| Phase 3                       | DB module — Drizzle codegen from schema, migrations           |
| Phase 4                       | Migration strategy for schema changes                         |
| Phase 5                       | REST API layer — route generation, request/response contracts |
| Phase 6                       | Auth module — JWT, roles, route protection                    |
| Phase 7                       | Testing — unit, integration, smoke tests                      |
| Phase 8                       | Admin panel — Vue 3, auto-generated forms                     |
| Phase 9                       | CLI — `init`, `dev`, `build`, `start`, `validate` commands    |
| Phase 10                      | Deployment — Lambda, Neon, CI/CD pipeline                     |

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
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Contributing

This project is in active early development. If you're interested in collaborating, read through the phase docs in `/docs` to understand where things currently stand before diving in.
