# Manguito CMS

> A self-hosted, developer-first headless CMS where content types are defined as JSON or YAML schemas.

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

The user-facing setup is minimal:

```ts
import { createSchemaParser } from '@manguito-cms-core'
import { createMyCmsAPI, createLocalAdapter } from '@manguito-cms-api'
import { createDrizzleModule, createPostgresAdapter } from '@manguito-cms-db'
import { createAdminPanel } from '@manguito-cms-admin'
import { createServer } from '@manguito-cms-server'

const schema = createSchemaParser({ basePath: './schema' })

const api = createMyCmsAPI({
  schema,
  db: createDrizzleModule({
    adapter: createPostgresAdapter(),
    url: process.env.DB_URL,
  }),
  storage: createLocalAdapter({ uploadDir: './uploads' }),
})

const server = createServer({
  api,
  admin: createAdminPanel({ schema }),
  port: 3000,
})
await server.initialize()
server.listen()
```

---

## Core Principles

**Schema-first.** The JSON/YAML schema file is the canonical definition of a content type. The DB, API, and UI are all derived from it — never the other way around.

**Layer isolation.** The parser knows nothing about the database. The DB module knows nothing about HTTP. The API knows nothing about Vue components. Each layer only communicates with the one directly below it.

**Serverless-first.** Designed for the burst-at-build, quiet-at-runtime traffic patterns of SSG projects, with a traditional server option available.

**Minimal by default, extensible by design.** A working CMS should be runnable with a few lines of configuration. Advanced features (custom roles, webhooks, multi-language) are addable without touching the core.

---

## Feature Scope

### Included in v1

- JSON and YAML schema parser with Zod validation
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
schema.json / schema.yaml
        │
        ▼
  Schema Parser           (@manguito-cms-core)
  + Field Type Registry
        │
   ┌────┴──────────┐
   ▼               ▼
DB Module       API Layer        (@manguito-cms-db, @manguito-cms-api)
(Drizzle)       (Hono)
   │               │
   ▼               ▼
Postgres      Admin Panel        (@manguito-cms-admin)
              (Vue 3)
```

The **Field Type Registry** is the architectural keystone. Every supported field type registers three things simultaneously: a Drizzle column definition, an API serialization shape, and a Vue form component. Because all three derive from the same registry entry, they are always in sync.

---

## Phases

| Phase                         | Focus                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| [Phase 1](./docs/phase-01.md) | Foundation — stack decisions, repo scaffold, tooling          |
| Phase 2                       | Schema parser and field type registry                         |
| Phase 3                       | DB module — Drizzle codegen from schema, migrations           |
| Phase 4                       | Migration strategy for schema changes                         |
| Phase 5                       | REST API layer — route generation, request/response contracts |
| Phase 6                       | Auth module — JWT, roles, route protection                    |
| Phase 7                       | Testing — unit, integration, smoke tests                      |
| Phase 8                       | Admin panel — Vue 3, auto-generated forms                     |
| Phase 9                       | Deployment — Lambda, Neon, CI/CD pipeline                     |

---

## Repository Structure

```
manguito-cms/
├── packages/
│   ├── core/        # Schema parser, field type registry
│   ├── db/          # Drizzle module, Postgres adapter, migrations
│   ├── api/         # Hono app, route generation, storage adapters
│   └── admin/       # Vue 3 admin panel
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
