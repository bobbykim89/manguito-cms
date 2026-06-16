# Decision — API Package Structure

> Defines the internal directory layout, entry points, and wiring strategy for `@bobbykim/manguito-cms-api`.

---

## Entry Points

The api package exposes three separate entry points to avoid bundling unused SDK dependencies:

```
@bobbykim/manguito-cms-api            ← createAPIAdapter + all route/middleware internals
@bobbykim/manguito-cms-api/storage    ← createLocalAdapter, createS3Adapter, createCloudinaryAdapter
@bobbykim/manguito-cms-api/runtime    ← createServer, createLambdaHandler, createVercelHandler
```

`/storage` and `/runtime` are separate because each adapter may pull in a heavy SDK (AWS SDK, Cloudinary SDK). Users only pay the bundle cost for what they actually use.

---

## tsup Configuration

```ts
// packages/api/tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/storage/index.ts',
    'src/runtime/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
```

## package.json exports

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./storage": {
      "import": "./dist/storage/index.js",
      "require": "./dist/storage/index.cjs",
      "types": "./dist/storage/index.d.ts"
    },
    "./runtime": {
      "import": "./dist/runtime/index.js",
      "require": "./dist/runtime/index.cjs",
      "types": "./dist/runtime/index.d.ts"
    }
  }
}
```

---

## Directory Structure

```
packages/api/src/
├── app.ts                      ← createAPIAdapter — wires everything together
├── routes/
│   ├── content.ts              ← public content route generation
│   ├── media.ts                ← public media retrieval routes
│   ├── admin/
│   │   ├── content.ts          ← admin content routes (write + unpublished access)
│   │   └── media.ts            ← admin media management routes
│   └── __tests__/
├── repositories/
│   ├── content.ts              ← wraps DrizzleContentRepository from db package
│   └── media.ts                ← media repository
├── middleware/
│   ├── auth.ts                 ← JWT validation, token_version check
│   ├── cors.ts
│   ├── error.ts
│   └── rate-limit.ts           ← sliding window rate limiter for findAll
├── codegen/
│   └── routes.ts               ← generateRoutes() — pure function, returns route group
├── storage/
│   ├── index.ts                ← storage subpath entry point
│   ├── types.ts                ← StorageAdapter interface (re-exported from core)
│   └── adapters/
│       ├── local.ts            ← createLocalAdapter
│       ├── s3.ts               ← createS3Adapter
│       └── cloudinary.ts       ← createCloudinaryAdapter
├── runtime/
│   ├── index.ts                ← runtime subpath entry point
│   ├── server.ts               ← createServer
│   ├── lambda.ts               ← createLambdaHandler
│   └── vercel.ts               ← createVercelHandler
└── index.ts                    ← public exports — createAPIAdapter only
```

---

## Repository Wiring — Dependency Injection

`DrizzleContentRepository` lives in `@bobbykim/manguito-cms-db`. The api package never imports from the db package directly — it depends only on the `ContentRepository<T>` interface defined in `@bobbykim/manguito-cms-core`.

```
@bobbykim/manguito-cms-core
  └── defines: ContentRepository<T> interface

@bobbykim/manguito-cms-db
  └── implements: DrizzleContentRepository
                  (satisfies ContentRepository<T>)

@bobbykim/manguito-cms-api
  └── depends on: ContentRepository<T> interface only
                  (receives DrizzleContentRepository injected at runtime via db adapter)
```

`createAPIAdapter` receives the `db` adapter and constructs repositories internally:

```ts
export function createAPIAdapter(options: CreateAPIAdapterOptions): APIAdapter {
  // repositories constructed from db adapter internally
  // api package never imports DrizzleContentRepository directly
}

type CreateAPIAdapterOptions = {
  prefix?: string                  // default: '/api'
  storage: StorageAdapter          // required — no default, hard error if missing
  rateLimit?: {
    findAll?: {
      windowMs?: number            // default: 60_000 (1 minute)
      maxPerIp?: number            // default: 30
      maxGlobal?: number           // default: 500
    }
  }
}
```

`storage` is required with no fallback. If omitted, startup fails with a clear error:

```
✗ api.storage is required but not configured.
  Add a storage adapter to your manguito.config.ts:

  api: createAPIAdapter({
    storage: createLocalAdapter(),   // dev
    // storage: createS3Adapter({ bucket: '...', region: '...' })  // production
  })

Exiting.
```

---

## Codegen Output

The CLI owns the write side of codegen. The api package reads generated files at runtime:

| Mode | CLI writes to | API reads from |
|------|--------------|----------------|
| `manguito dev` | `.manguito/` at project root | `.manguito/routes.ts` |
| `manguito build` | `dist/generated/` at project root | `dist/generated/routes.ts` |

Both directories are in `.gitignore` — they are build artifacts, not source.

The generated files import primitives from the api package (`createContentRoutes`, `createAdminRoutes`, etc.) and assemble them with the parsed schema. The api package provides the primitives; the CLI generates the assembly.

---

## Layer Boundaries

The api package sits between core/db and the outside world. It must never cross these boundaries:

```
api → imports from: core, db (via injected repositories only)
api → never imports from: admin, cli
```

`DrizzleContentRepository` is accessed only through the `ContentRepository<T>` interface — the api package has no direct Drizzle dependency.
