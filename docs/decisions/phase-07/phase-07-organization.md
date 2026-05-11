# Decision — Test Organization Across the Monorepo

> Folder structure, shared utilities package, and per-package test conventions.

---

## Folder Structure Per Package

Established in Phase 1, carried forward unchanged:

```
packages/<name>/
├── src/
│   └── <module>/
│       ├── index.ts
│       └── __tests__/
│           └── <module>.test.ts    ← unit tests beside source
└── tests/
    └── integration.test.ts         ← integration tests at package root
```

Unit tests live in `src/__tests__/` beside the source they test. Integration tests live in `tests/` at the package root. This separation makes it easy to run only unit tests during development and only integration tests when a real DB is available.

---

## Shared Test Utilities — `@bobbykim/manguito-cms-test-utils`

A private, never-published workspace package that provides shared test infrastructure for backend packages.

### Why a package, not a folder

Using a `packages/test-utils/` folder without a `package.json` would require relative path imports across packages — messy, hard to maintain, and invisible to Turborepo's task graph. A proper workspace package means:
- Clean named imports: `import { createTestApp } from '@bobbykim/manguito-cms-test-utils'`
- Turborepo models it as a dependency — task ordering (build before test) is reliable
- Behaves like any other workspace package, just never published

### Package configuration

```json
{
  "name": "@bobbykim/manguito-cms-test-utils",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "devDependencies": {
    "@bobbykim/manguito-cms-core": "workspace:*",
    "@bobbykim/manguito-cms-db": "workspace:*",
    "@bobbykim/manguito-cms-api": "workspace:*"
  }
}
```

`private: true` is the critical field — it prevents accidental publishing. No `files` array, no `dist/` output. This package is consumed directly from source in test environments only.

### Package structure

```
packages/test-utils/
├── package.json
├── tsconfig.json
└── src/
    ├── db.ts          ← test DB connection, teardown helpers
    ├── fixtures.ts    ← ParsedSchema fixture, role user seed shapes
    ├── requests.ts    ← createTestApp(), authenticatedRequest()
    └── index.ts       ← barrel export
```

---

## What Each File Provides

### `db.ts`

Helpers for managing the test DB connection lifecycle:

- `getTestDb()` — returns a connected `PostgresAdapter` pointed at the test DB URL from `.env.test`
- `teardownTestData(db, ...tableNames)` — deletes rows from specified tables, used by write tests to clean up after themselves

### `fixtures.ts`

Reusable, deterministic test data:

- `testParsedSchema` — a minimal but realistic `ParsedSchema` fixture. Includes at least one content type with several field types, one taxonomy type, one paragraph type, and one enum type. Defined once, used by all packages that need a schema.
- `testRoleUsers` — seed shapes for one user per role (admin, manager, editor, writer, viewer). Used by `globalSetup` to insert the global user fixtures.

The fixture schema should be stable across phases. If a new field type is added, add it to the fixture so it is always covered.

### `requests.ts`

API test helpers:

- `createTestApp(schema, db)` — constructs a fully wired Hono app instance using the provided `ParsedSchema` and DB connection. Never reads `manguito.config.ts` from disk. Builds the roles registry from the test fixture roles. Returns the app instance ready to receive `app.request()` calls.
- `authenticatedRequest(app, role, path, options)` — constructs a request with a pre-signed JWT for the given role, sets the `Cookie` header correctly. Never calls the login endpoint. Returns the Hono response.

---

## Consumers

| Package | Consumes from test-utils |
|---------|--------------------------|
| `packages/db` | `getTestDb()`, `testParsedSchema` |
| `packages/api` | `getTestDb()`, `testParsedSchema`, `createTestApp()`, `authenticatedRequest()` |
| `apps/sandbox` | `createTestApp()`, `authenticatedRequest()`, `testParsedSchema` |
| `packages/core` | None — core tests are pure, no DB or app needed |
| `packages/admin` | None — Vue-specific test utilities managed locally, deferred to Phase 8 |
| `packages/cli` | None — CLI test strategy deferred to Phase 9 |

---

## Test File Ordering

**Across packages:** Turborepo's task graph enforces natural order — `core` tests run before `db` tests, `db` tests run before `api` tests, matching the dependency chain.

**Within test files:** `describe` blocks and individual tests follow the natural lifecycle order of a real operation. For example, a content API test file follows: create → read → update → delete. This makes the test file readable as a narrative and allows state set up by earlier tests to be used by later ones within the same file.

---

## Admin and CLI Test Strategy

**Admin (`packages/admin`):** Vue component testing with Vitest + Vue Test Utils has different concerns from backend testing. Test utilities for the admin package are managed locally within that package. This is deferred to Phase 8 when the admin panel is built.

**CLI (`packages/cli`):** CLI testing strategy is deferred to Phase 9. The default approach is Option A — test the underlying logic (functions from `core`, `db`, `api`) rather than the binary. The thin CLI wiring layer is lightly tested. Phase 9 may revisit if specific commands require end-to-end binary invocation tests.
