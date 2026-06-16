# Phase 1 — Foundation

> Stack decisions, repo scaffold, tooling setup, and coding conventions.

This phase produces no application logic. The output is a working monorepo that every subsequent phase builds on top of. Getting this right is worth the time — a messy foundation creates friction for every collaborator on every future task.

**Done when:** The repo is scaffolded, all tooling is configured, `pnpm dev` from the root starts all watch processes in dependency order, and `pnpm test` from the root runs successfully across all packages (even with empty test suites).

---

## Decisions Made

### Project Identity

| Item           | Decision                                             |
| -------------- | ---------------------------------------------------- |
| Project name   | Manguito CMS                                         |
| npm scope      | `@bobbykim`                                          |
| Package naming | `@bobbykim/manguito-cms-{core\|db\|api\|admin\|cli}` |

Named after Manguito, a pet bird, consistent with the existing Manguito Component Library (`@bobbykim/manguito-theme`, `@bobbykim/mcl-*`).

**Why hyphenated packages over subpath exports:**
`@bobbykim/manguito-cms/core` is not a separate npm package — the slash after the scope is part of the package name, and further slashes create subpath export routes within a single package, not independent packages. Separate hyphenated packages (`-core`, `-db`, etc.) allow independent versioning, lean dependency footprints (a user of `core` does not pull in the AWS SDK), and match the existing library naming convention.

---

### Runtime and Node Version

| Decision        | Choice                   |
| --------------- | ------------------------ |
| Language        | TypeScript (strict mode) |
| Runtime         | Node.js 22+              |
| Package manager | pnpm                     |

Node 22 is the current LTS and is supported until April 2027. Node 20 reaches EOL April 2025 so it is not a valid target. Enforce this in two places:

**Root `package.json`:**

```json
{
  "engines": { "node": ">=22.0.0" }
}
```

**`.nvmrc` at repo root:**

```
22
```

TypeScript throughout — no JavaScript files in `packages/`. The `apps/sandbox` test harness is also TypeScript.

---

### Monorepo Tooling

| Concern            | Decision       | Rationale                                           |
| ------------------ | -------------- | --------------------------------------------------- |
| Package linking    | pnpm workspace | Native cross-package linking, no bootstrapping step |
| Task orchestration | Turborepo      | Dependency-aware task runner with build caching     |
| Version management | Changesets     | Per-package versioning with accumulated changelogs  |

**Why not Lerna:** Lerna historically bundled package linking, task running, and versioning into one tool and did none of them particularly well. The modern stack replaces each concern with a dedicated tool that does it better. Lerna today largely delegates to pnpm and Turborepo anyway.

**Why Turborepo:** Turborepo is a task runner and build cache — not a deployment tool. It runs `build`, `test`, `lint` scripts across packages in correct dependency order, and caches outputs so unchanged packages do not rebuild. A change to `core` triggers rebuilds in `db`, `api`, `admin`, and `cli` — but not the reverse.

**Changesets workflow:**

```bash
# After a meaningful change, before committing
pnpm changeset
# → prompts: which packages changed? patch/minor/major? describe it
# → writes a .changeset/<random-name>.md file — commit this with your code

# When ready to release
pnpm changeset version   # bumps versions, updates changelogs
pnpm changeset publish   # publishes changed packages to npm
```

---

### Build Tooling — tsup

**tsup** is the build tool for all `packages/*`. It is built on esbuild, dramatically faster than `tsc --watch`, and is the standard build tool across the ecosystem this project depends on (Hono, Drizzle, etc.).

Each package gets a `tsup.config.ts`:

```ts
// packages/core/tsup.config.ts  (same shape for db, api, cli)
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'], // dual format — see Module Format below
  dts: true, // generates .d.ts type declarations
  clean: true, // clears dist/ before each build
  sourcemap: true,
})
```

Package scripts:

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch"
  }
}
```

Turborepo runs `dev` across all packages simultaneously. tsup's watch mode rebuilds only changed files and Turborepo propagates the change downstream automatically — significantly faster feedback than `tsc --watch`.

**`packages/admin`** uses Vite for its build (Vue 3 + Vite is the standard) and does not use tsup.

---

### Module Format — Dual ESM + CJS

All `packages/*` published to npm emit **both ESM and CJS**. This ensures compatibility across the broadest range of consumers — Next.js projects, plain Node scripts, and Vite apps all have different module resolution expectations.

`apps/sandbox` emits **ESM only** since it is never published and Node 22 handles pure ESM without issues.

**`package.json` exports field for published packages:**

```json
{
  "name": "@bobbykim/manguito-cms-core",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"]
}
```

`exports` is used by modern bundlers and Node 22. `main` and `module` are fallbacks for older tooling. `files: ["dist"]` ensures only compiled output goes to npm — source, tests, and config files are excluded.

---

### Testing — Vitest

**Vitest** is the test runner for all packages including backend (`core`, `db`, `api`) and frontend (`admin`). It is Jest-compatible, TypeScript-native, and shares Vite's config — a single tool covers the entire monorepo with no per-package configuration differences.

**Pactum is not used.** For API integration tests, Vitest paired with Hono's built-in `app.request()` test helper is sufficient and has no extra dependencies. Pactum can be reconsidered in a future phase if contract testing becomes a specific requirement.

Test structure per package:

```
packages/core/
├── src/
│   ├── parser/
│   │   ├── index.ts
│   │   └── __tests__/
│   │       └── parser.test.ts    ← unit tests beside the source
└── tests/
    └── integration.test.ts       ← integration tests at package root
```

**Unit tests** (`src/__tests__/`) cover pure functions in complete isolation — the parser, field type registry, individual route handlers. No database, no network.

**Integration tests** (`tests/`) test the DB module against a real Postgres instance (local Docker) and the API against a live Hono server with a test database.

Root `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

Each package can extend this config if needed. Turborepo runs `vitest run` across all packages via `pnpm test`.

---

### Environment Variables — dotenv-cli

**dotenv-cli** manages environment files across dev, test, and production contexts. It allows specifying which `.env` file to load per command without any code changes.

**File conventions:**

| File           | Committed       | Purpose                                          |
| -------------- | --------------- | ------------------------------------------------ |
| `.env`         | No — gitignored | Local overrides, real credentials                |
| `.env.example` | Yes             | Documents all required variables, no real values |
| `.env.test`    | Yes             | Safe test values, no real credentials            |

`.env` is always in `.gitignore`. `.env.example` and `.env.test` are committed so collaborators know exactly which variables are needed and tests run consistently without local setup.

**Script conventions:**

```json
{
  "scripts": {
    "dev": "dotenv -e .env -- manguito dev",
    "test": "dotenv -e .env.test -- vitest run"
  }
}
```

**Required variables (to be documented in `.env.example`):**

```bash
# Database
DB_URL=

# Storage (S3)
S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Storage (Cloudinary) — alternative to S3
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Auth
AUTH_SECRET=

# Server
PORT=3000
NODE_ENV=development
ALLOWED_ORIGIN=
```

The CLI will validate that required variables are present at startup and emit a clear error message if any are missing — rather than letting a missing `DB_URL` produce a cryptic Postgres connection error at runtime.

---

### Error Handling and API Response Conventions

#### Internal — Result Type

Functions that can fail use a **Result type** rather than throwing exceptions. A missing schema file or a validation error are expected conditions, not exceptional ones — throwing for expected conditions makes control flow hard to follow.

```ts
type Result<T, E = AppError> = { ok: true; data: T } | { ok: false; error: E }

// usage — no try/catch needed for expected failures
const result = parseSchema(input)
if (!result.ok) {
  return result // propagate upward
}
// result.data is typed and available here
```

`AppError` is a typed error object defined in `core`:

```ts
type AppError = {
  code: ErrorCode // machine-readable string enum
  message: string // human-readable description
  details?: unknown // optional structured context (e.g. Zod issues)
}
```

Thrown exceptions are reserved for truly unexpected conditions — programmer errors, unrecoverable states.

#### HTTP — Consistent Response Envelope

All API responses use a consistent JSON envelope. HTTP status codes still follow convention (200, 201, 400, 401, 403, 404, 500) — the envelope is in addition to, not instead of, correct status codes.

```ts
// success
{
  "ok": true,
  "data": { ...content }
}

// error
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",     // machine-readable — matches ErrorCode enum
    "message": "Title is required", // human-readable
    "details": [...]                // optional — e.g. field-level validation issues
  }
}
```

The `code` field allows clients to handle specific error types programmatically without string-matching on `message`. This is the pattern used by well-regarded APIs (Stripe, Linear) and maps cleanly to the internal `AppError` type.

---

### Tech Stack

#### Core — `@bobbykim/manguito-cms-core`

`core` has **no runtime dependencies beyond Zod**. It contains the schema parser, field type registry, and `defineConfig`. Keeping it dependency-light means it can be tested in full isolation and used without pulling in Drizzle or Hono.

`defineConfig` lives in `core` because it defines the contract between the user and the entire system. The CLI reads it; individual packages consume the resolved config.

#### DB Layer — `@bobbykim/manguito-cms-db`

| Concern            | Library                            |
| ------------------ | ---------------------------------- |
| ORM                | Drizzle ORM                        |
| Database           | Postgres (Neon for serverless)     |
| Connection pooling | Neon serverless driver / PgBouncer |

**Drizzle over Prisma:** Drizzle exposes SQL-close queries as typed TypeScript, making it straightforward to generate table definitions programmatically from schema output. Prisma's schema-file-based approach is less amenable to code generation.

**Neon for serverless:** Standard Postgres TCP connections are expensive on cold Lambda starts. Neon provides an HTTP-based Postgres driver that sidesteps this. For self-hosted or EC2 deployments, a standard `pg` connection with PgBouncer pooling is used instead.

#### API Layer — `@bobbykim/manguito-cms-api`

| Concern           | Library           |
| ----------------- | ----------------- |
| HTTP framework    | Hono              |
| Schema validation | Zod               |
| OpenAPI spec      | @hono/zod-openapi |
| Auth              | Better Auth       |

**Hono over Express:** Hono runs natively on AWS Lambda, Cloudflare Workers, Bun, and Deno with no adapters. Express was built for long-running Node processes and shows its age in serverless contexts. Hono is also TypeScript-native with no `@types/` package needed.

**OpenAPI:** The spec is generated automatically from route definitions at build time — served at `/api/openapi.json`. Swagger UI is intentionally excluded from the server to avoid Lambda asset-serving issues; developers can point Postman, Insomnia, or VS Code REST Client at the spec endpoint directly. This will be covered in detail in Phase 5.

#### Admin Panel — `@bobbykim/manguito-cms-admin`

| Concern    | Library                 |
| ---------- | ----------------------- |
| Framework  | Vue 3 (Composition API) |
| Build tool | Vite                    |
| Styling    | Tailwind CSS            |
| Components | shadcn-vue              |

#### CLI — `@bobbykim/manguito-cms-cli`

| Concern             | Library                           |
| ------------------- | --------------------------------- |
| CLI framework       | citty                             |
| Interactive prompts | clack                             |
| Template engine     | handlebars (for `init` templates) |

The CLI owns the `manguito` binary and the full dev/build/start lifecycle. It reads `manguito.config.ts` and orchestrates all other packages. It is the last package built since it depends on all others being stable, but it is scaffolded as an empty package in Phase 1 so the dependency graph is established.

---

### Dev vs. Production Architecture

The user writes one config file (`manguito.config.ts`) and never thinks about modes. The CLI infers the correct behaviour from the command being run.

**Dev mode (`manguito dev`)**

- Reads `manguito.config.ts`
- Parses schemas dynamically at startup
- Watches schema files for changes, re-parses on save
- Mounts Vite dev server for admin panel as Hono middleware
- Suitable for `apps/sandbox` local development

**Production build (`manguito build`)**

- Reads `manguito.config.ts`
- Runs schema codegen → writes static artifacts to `dist/generated/`
- Runs DB migrations
- Compiles everything to `dist/`
- Emits `dist/server.js` (traditional) and `dist/handler.js` (Lambda)

**Production runtime (`manguito start` / Lambda handler)**

- Imports pre-generated `dist/generated/` artifacts — no schema parsing
- Minimal cold start, no file I/O at request time

```
schemas/           ← human-authored, version-controlled
    └── content-types/blog-post.json
          ↓  manguito build
dist/generated/    ← generated in CI, never hand-edited
    ├── schema.ts      (Drizzle table definitions)
    ├── routes.ts      (Hono route registrations)
    └── forms.ts       (Vue form component definitions)
```

This distinction should be kept in mind when designing the parser in Phase 2: parser output must be **serializable plain objects** (no class instances, no functions) so they can be written to disk and re-imported cleanly.

---

### Storage Adapters

All storage adapters implement a shared `StorageAdapter` interface, so the rest of the system is agnostic to where files are stored. Adapters live in `@bobbykim/manguito-cms-api` as separate entry points so users don't pay the bundle cost for SDKs they don't use.

```ts
interface StorageAdapter {
  upload(file: File | Buffer, options: UploadOptions): Promise<UploadResult>
  delete(key: string): Promise<void>
  getUrl(key: string): string
}
```

| Adapter                   | Use case                                                   |
| ------------------------- | ---------------------------------------------------------- |
| `createLocalAdapter`      | Local dev and sandbox only — not for production            |
| `createS3Adapter`         | Production — AWS S3 or any S3-compatible storage           |
| `createCloudinaryAdapter` | Production — image transforms, format/quality optimization |
| Azure / GCP adapters      | Planned v2+                                                |

---

### Coding Style

**Functional over OOP for the public API.** The core operations — parse schema, generate table definition, generate route, generate form field — are all data transformations. Pure functions are easier to test, easier to reason about, and have less surface area for implicit state bugs.

Classes are acceptable internally when something genuinely has state and identity (e.g. a connection pool manager). They are not the default.

**Factory functions over constructors for the public API:**

```ts
// preferred
const api = createMyCmsAPI({ schema, db, storage })

// avoid
const api = new MyCmsAPI({ schema, db, storage })
```

**Builder pattern** only when steps have order dependency or meaningful per-step validation. For flat configuration, a typed options object is simpler and equally readable.

**Arrow functions for callbacks and short expressions. Named function declarations for top-level exported functions:**

```ts
// top-level export
export function createSchemaParser(options: SchemaParserOptions): SchemaParser { ... }

// callback / inline
const fields = entries.map((entry) => parseField(entry))
```

**No barrel `index.ts` files that re-export everything.** Each package exports explicitly from its entry point. This keeps tree-shaking effective and import paths meaningful.

---

### Schema Definition Format

Both JSON and YAML are supported. Internally everything normalises to the same TypeScript object after parsing — the format is a user preference, not an architectural concern.

```
schemas/
├── content-types/
│   ├── home-page.json
│   └── blog-post.yaml
├── paragraph-types/
│   └── card-accordion.json
├── taxonomy-types/
│   └── tag.json
└── roles/
    └── roles.json
```

---

## Repository Structure

```
manguito-cms/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── parser/          # Schema file loading and validation
│   │   │   │   └── __tests__/
│   │   │   ├── registry/        # Field type registry
│   │   │   │   └── __tests__/
│   │   │   ├── config/          # defineConfig
│   │   │   └── index.ts
│   │   ├── tests/               # Integration tests
│   │   ├── tsup.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json         # @bobbykim/manguito-cms-core
│   │
│   ├── db/
│   │   ├── src/
│   │   │   ├── adapters/        # PostgresAdapter
│   │   │   │   └── __tests__/
│   │   │   ├── migrations/      # Migration runner
│   │   │   ├── codegen/         # Schema → Drizzle table definitions
│   │   │   │   └── __tests__/
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── tsup.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json         # @bobbykim/manguito-cms-db
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/          # Dynamic route generation from schema
│   │   │   │   └── __tests__/
│   │   │   ├── middleware/      # Auth, CORS, error handling
│   │   │   ├── storage/
│   │   │   │   ├── types.ts     # StorageAdapter interface
│   │   │   │   └── adapters/
│   │   │   │       ├── local.ts
│   │   │   │       ├── s3.ts
│   │   │   │       └── cloudinary.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── tsup.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json         # @bobbykim/manguito-cms-api
│   │
│   ├── admin/
│   │   ├── src/
│   │   │   ├── components/      # shadcn-vue + custom components
│   │   │   ├── views/           # Page-level components
│   │   │   ├── composables/     # Vue composables
│   │   │   └── main.ts
│   │   ├── vite.config.ts       # Also used by Vitest for admin tests
│   │   ├── tsconfig.json
│   │   └── package.json         # @bobbykim/manguito-cms-admin
│   │
│   └── cli/
│       ├── src/
│       │   ├── commands/
│       │   │   ├── init.ts
│       │   │   ├── dev.ts
│       │   │   ├── build.ts
│       │   │   ├── start.ts
│       │   │   └── migrate.ts
│       │   ├── templates/
│       │   │   ├── manguito.config.ts.hbs
│       │   │   ├── schemas/
│       │   │   │   └── content-types/
│       │   │   │       └── example-page.json
│       │   │   └── .env.example
│       │   └── index.ts
│       ├── tsup.config.ts
│       ├── tsconfig.json
│       └── package.json         # @bobbykim/manguito-cms-cli  "bin": { "manguito": "./dist/index.js" }
│
├── apps/
│   └── sandbox/
│       ├── schemas/
│       │   ├── content-types/
│       │   │   └── example-page.json
│       │   └── roles/
│       │       └── roles.json
│       ├── manguito.config.ts
│       ├── .env.example
│       └── package.json         # private, workspace:* deps, ESM only
│
├── docs/
│   ├── phase-01.md              # This file
│   └── decisions/               # ADR files for significant decisions
│
├── CLAUDE.md
├── .changeset/
├── .nvmrc                       # 22
├── turbo.json
├── vitest.config.ts             # Root vitest config
├── pnpm-workspace.yaml
├── package.json                 # Root — workspace scripts, engines: node >=22
├── .eslintrc.json
├── tsconfig.base.json
└── .gitignore                   # includes .env, dist/, node_modules/
```

---

## Workspace Configuration

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

### Root `package.json`

```json
{
  "private": true,
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "latest",
    "@changesets/cli": "latest",
    "typescript": "^5.0.0",
    "eslint": "^9.0.0",
    "vitest": "latest",
    "dotenv-cli": "latest"
  }
}
```

### Published package `package.json` shape

```json
{
  "name": "@bobbykim/manguito-cms-core",
  "version": "0.0.1",
  "engines": { "node": ">=22.0.0" },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "dotenv -e .env.test -- vitest run"
  }
}
```

### Package cross-references

```json
// packages/api/package.json — depends on core and db
{
  "dependencies": {
    "@bobbykim/manguito-cms-core": "workspace:*",
    "@bobbykim/manguito-cms-db":   "workspace:*"
  }
}

// packages/cli/package.json — depends on all packages
{
  "bin": { "manguito": "./dist/index.js" },
  "dependencies": {
    "@bobbykim/manguito-cms-core":  "workspace:*",
    "@bobbykim/manguito-cms-db":    "workspace:*",
    "@bobbykim/manguito-cms-api":   "workspace:*",
    "@bobbykim/manguito-cms-admin": "workspace:*"
  }
}

// apps/sandbox/package.json — private, not published
{
  "private": true,
  "dependencies": {
    "@bobbykim/manguito-cms-core":  "workspace:*",
    "@bobbykim/manguito-cms-db":    "workspace:*",
    "@bobbykim/manguito-cms-api":   "workspace:*",
    "@bobbykim/manguito-cms-admin": "workspace:*",
    "@bobbykim/manguito-cms-cli":   "workspace:*"
  }
}
```

---

## Local Testing Strategy

**`apps/sandbox`** is the primary local testing tool. It exercises the public API the way a real user would — a minimal but complete CMS instance wired to workspace-linked packages via `manguito.config.ts`.

```ts
// apps/sandbox/manguito.config.ts
import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { createLocalAdapter } from '@bobbykim/manguito-cms-api'

export default defineConfig({
  schema: { basePath: './schemas' },
  db: {
    adapter: createPostgresAdapter(),
    url: process.env.DB_URL,
  },
  storage: createLocalAdapter({ uploadDir: './uploads' }),
})
```

**For cross-project testing** (verifying the package behaves correctly when installed outside the monorepo), use `yalc`. It simulates a publish/install cycle locally without touching npm. Use this when approaching an actual release.

---

## CLAUDE.md

A `CLAUDE.md` file at the repo root provides Claude Code with a concise brief on every session. Keep it short — it's a quick orientation, not a full spec. The phase docs carry the detail.

```md
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
```

Update `## Current phase` and `## Completed phases` when moving between phases.

---

## Checklist

**Repo initialisation**

- [ ] Initialise git repo
- [ ] Add `.gitignore` — includes `.env`, `dist/`, `node_modules/`, `.turbo/`
- [ ] Add `.nvmrc` with content `22`

**Root configuration**

- [ ] Create root `package.json` — private, `engines: node >=22`, workspace scripts
- [ ] Add `pnpm-workspace.yaml`
- [ ] Install and configure Turborepo — `turbo.json`
- [ ] Initialise Changesets — `pnpm changeset init`
- [ ] Add shared `tsconfig.base.json`
- [ ] Add shared ESLint config — `.eslintrc.json`
- [ ] Add root `vitest.config.ts`

**Package scaffolds**

- [ ] Scaffold `packages/core` — `package.json` (dual ESM/CJS exports), `tsup.config.ts`, `tsconfig.json`, empty `src/index.ts`
- [ ] Scaffold `packages/db` — same
- [ ] Scaffold `packages/api` — same
- [ ] Scaffold `packages/admin` — Vite + Vue 3 + Tailwind init, `package.json`
- [ ] Scaffold `packages/cli` — `package.json` with `bin` field, `tsup.config.ts`, empty `src/index.ts`

**Apps**

- [ ] Scaffold `apps/sandbox` — `manguito.config.ts`, example schemas, `.env.example`, `workspace:*` deps

**Docs and Claude**

- [ ] Add `CLAUDE.md` at repo root
- [ ] Add `docs/` folder with `phase-01.md`

**Verification**

- [ ] `pnpm install` — all cross-package workspace links resolve correctly
- [ ] `pnpm build` — completes across all packages in dependency order
- [ ] `pnpm dev` — starts all watch processes without errors
- [ ] `pnpm test` — runs successfully (empty test suites are fine)
- [ ] Write first `.changeset` entry describing the initial scaffold
