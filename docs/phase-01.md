# Phase 1 — Foundation

> Stack decisions, repo scaffold, tooling setup, and coding conventions.

This phase produces no application logic. The output is a working monorepo that every subsequent phase builds on top of. Getting this right is worth the time — a messy foundation creates friction for every collaborator on every future task.

**Done when:** The repo is scaffolded, all tooling is configured, a `pnpm dev` from the root starts all watch processes in dependency order, and a `pnpm test` from the root runs successfully across all packages.

---

## Decisions Made

### Monorepo Tooling

| Concern            | Decision       | Rationale                                           |
| ------------------ | -------------- | --------------------------------------------------- |
| Package linking    | pnpm workspace | Native cross-package linking, no bootstrapping step |
| Task orchestration | Turborepo      | Dependency-aware task runner with build caching     |
| Version management | Changesets     | Per-package versioning with accumulated changelogs  |

**Why not Lerna:** Lerna historically bundled package linking, task running, and versioning into one tool and did none of them particularly well. The modern stack replaces each concern with a dedicated tool that does it better. Lerna today largely delegates to pnpm and Turborepo anyway.

**Why Turborepo over Lerna for tasks:** Turborepo is a task runner and build cache, not a deployment tool. It runs `build`, `test`, `lint` scripts across packages in correct dependency order, and caches outputs so unchanged packages do not rebuild. A change to `core` triggers rebuilds in `db`, `api`, and `admin` — but not the reverse.

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

### Language and Runtime

| Decision        | Choice                   |
| --------------- | ------------------------ |
| Language        | TypeScript (strict mode) |
| Runtime         | Node.js 20+              |
| Package manager | pnpm                     |

TypeScript throughout — no JavaScript files in `packages/`. The `apps/sandbox` test harness is also TypeScript.

---

### Tech Stack

#### API Layer — `@bobbykim/manguito-cms-api`

| Concern           | Library     |
| ----------------- | ----------- |
| HTTP framework    | Hono        |
| Schema validation | Zod         |
| Auth              | Better Auth |

**Hono over Express:** Hono runs natively on AWS Lambda, Cloudflare Workers, Bun, and Deno with no adapters. Express was built for long-running Node processes and shows its age in serverless contexts. Hono is also TypeScript-native with no `@types/` package needed.

#### DB Layer — `@bobbykim/manguito-cms-db`

| Concern            | Library                            |
| ------------------ | ---------------------------------- |
| ORM                | Drizzle ORM                        |
| Database           | Postgres (Neon for serverless)     |
| Connection pooling | Neon serverless driver / PgBouncer |

**Drizzle over Prisma:** Drizzle exposes SQL-close queries as typed TypeScript, which makes it straightforward to generate table definitions programmatically from schema output. Prisma's schema-file-based approach is less amenable to code generation.

**Neon for serverless:** Standard Postgres TCP connections are expensive to establish on cold Lambda starts. Neon provides an HTTP-based Postgres driver that sidesteps this. For self-hosted or EC2 deployments, a standard `pg` connection with PgBouncer pooling is used instead.

#### Admin Panel — `@bobbykim/manguito-cms-admin`

| Concern    | Library                 |
| ---------- | ----------------------- |
| Framework  | Vue 3 (Composition API) |
| Build tool | Vite                    |
| Styling    | Tailwind CSS            |
| Components | shadcn-vue              |

#### Core — `@bobbykim/manguito-cms-core`

`@bobbykim/manguito-cms-core` has **no runtime dependencies** beyond Zod. It contains only the schema parser and field type registry. Keeping it dependency-light means it can be tested in full isolation and used without pulling in Drizzle or Hono.

---

### Storage Adapters

All storage adapters implement a shared `StorageAdapter` interface, so the rest of the system is agnostic to where files are stored.

```ts
interface StorageAdapter {
  upload(file: File | Buffer, options: UploadOptions): Promise<UploadResult>
  delete(key: string): Promise<void>
  getUrl(key: string): string
}
```

| Adapter                   | Package                      | Use case                                           |
| ------------------------- | ---------------------------- | -------------------------------------------------- |
| `createLocalAdapter`      | `@bobbykim/manguito-cms-api` | Local dev and sandbox testing only                 |
| `createS3Adapter`         | `@bobbykim/manguito-cms-api` | Production — AWS S3 or S3-compatible               |
| `createCloudinaryAdapter` | `@bobbykim/manguito-cms-api` | Production — image transforms, format optimization |
| Azure / GCP adapters      | —                            | Planned v2+                                        |

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

Both JSON and YAML are supported. Internally everything normalises to the same TypeScript object after parsing — the format is just a user preference.

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
│   │   │   ├── registry/        # Field type registry
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── db/
│   │   ├── src/
│   │   │   ├── adapters/        # PostgresAdapter (more adapters later)
│   │   │   ├── migrations/      # Migration runner
│   │   │   ├── codegen/         # Schema → Drizzle table definition
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/          # Dynamic route generation from schema
│   │   │   ├── middleware/       # Auth, CORS, error handling
│   │   │   ├── storage/
│   │   │   │   ├── types.ts     # StorageAdapter interface
│   │   │   │   └── adapters/
│   │   │   │       ├── local.ts
│   │   │   │       ├── s3.ts
│   │   │   │       └── cloudinary.ts
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── admin/
│       ├── src/
│       │   ├── components/      # shadcn-vue + custom components
│       │   ├── views/           # Page-level components
│       │   ├── composables/     # Vue composables
│       │   └── main.ts
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── apps/
│   └── sandbox/
│       ├── schemas/
│       │   ├── content-types/
│       │   │   └── home-page.json
│       │   └── roles/
│       │       └── roles.json
│       ├── index.ts             # Boots the CMS using workspace-linked packages
│       └── package.json
│
├── docs/
│   ├── phase-01.md             # This file
│   └── decisions/              # ADR files for significant decisions
│
├── .changeset/
├── turbo.json
├── pnpm-workspace.yaml
├── package.json                # Root — workspace scripts only, no app code
├── .eslintrc.json
├── tsconfig.base.json
└── .gitignore
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

The `^build` syntax means "build all dependencies first". So when `api` runs `dev`, Turborepo first ensures `core` and `db` are built. Changes to `core` source trigger a rebuild which propagates to `api` and `sandbox` automatically.

### Root `package.json`

```json
{
  "private": true,
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
    "eslint": "^9.0.0"
  }
}
```

### Package cross-references

Each package that depends on another references it with the `workspace:*` protocol:

```json
// packages/api/package.json
{
  "name": "@bobbykim/manguito-cms-api",
  "dependencies": {
    "@bobbykim/manguito-cms-core": "workspace:*",
    "@bobbykim/manguito-cms-db": "workspace:*"
  }
}
```

```json
// apps/sandbox/package.json
{
  "name": "sandbox",
  "private": true,
  "dependencies": {
    "@bobbykim/manguito-cms-core": "workspace:*",
    "@bobbykim/manguito-cms-db": "workspace:*",
    "@bobbykim/manguito-cms-api": "workspace:*",
    "@bobbykim/manguito-cms-admin": "workspace:*"
  }
}
```

---

## Local Testing Strategy

The `apps/sandbox` app is the primary local testing tool. It acts as a realistic consumer of the library — not just a test runner, but a minimal CMS instance that exercises the public API the way a real user would.

```ts
// apps/sandbox/index.ts
import { createSchemaParser } from '@bobbykim/manguito-cms-core'
import { createMyCmsAPI, createLocalAdapter } from '@bobbykim/manguito-cms-api'
import {
  createDrizzleModule,
  createPostgresAdapter,
} from '@bobbykim/manguito-cms-db'
import { createAdminPanel } from '@bobbykim/manguito-cms-admin'
import { createServer } from '@bobbykim/manguito-cms-api'

const schema = createSchemaParser({
  basePath: './schemas',
})

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

**Unit tests** live inside each package in `src/__tests__/`. These test pure functions in isolation — the parser, the field type registry, individual route handlers.

**Integration tests** live in a `tests/` folder at the package root. These test the DB module against a real Postgres instance and the API against a real Hono server with an in-memory or test DB.

**For cross-project testing** (verifying the package behaves correctly when installed outside the monorepo), use `yalc`. It simulates a publish/install cycle locally without touching npm.

---

## Checklist

- [ ] Initialise git repo with `.gitignore`
- [ ] Create root `package.json` (private, scripts only)
- [ ] Add `pnpm-workspace.yaml`
- [ ] Install and configure Turborepo (`turbo.json`)
- [ ] Initialise Changesets (`pnpm changeset init`)
- [ ] Add shared `tsconfig.base.json`
- [ ] Add shared ESLint config
- [ ] Scaffold `packages/core` with `package.json`, `tsconfig.json`, empty `src/index.ts`
- [ ] Scaffold `packages/db` with same
- [ ] Scaffold `packages/api` with same
- [ ] Scaffold `packages/admin` with Vite + Vue 3 + Tailwind
- [ ] Scaffold `apps/sandbox` with `workspace:*` dependencies
- [ ] Verify `pnpm install` resolves cross-package links correctly
- [ ] Verify `pnpm dev` from root starts all watch processes in order
- [ ] Verify `pnpm test` from root runs (even with empty test suites)
- [ ] Add `docs/` folder, copy this file in
- [ ] Write first `.changeset` entry describing the initial scaffold
