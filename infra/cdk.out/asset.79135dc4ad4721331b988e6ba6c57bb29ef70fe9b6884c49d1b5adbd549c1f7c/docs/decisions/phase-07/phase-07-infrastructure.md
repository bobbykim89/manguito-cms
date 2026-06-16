# Decision — Integration Test Infrastructure

> Docker Postgres lifecycle, globalSetup responsibilities, and CI database strategy.

---

## Local Development — Manual Docker Compose

For local development, the test Postgres instance is a **manual prerequisite**. Developers start it using the Docker Compose file established in Phase 3:

```bash
docker compose up -d
```

This is low friction in practice — developers already have Docker running during normal development sessions. The test DB is a separate container from the dev DB, pointed to by `.env.test`.

---

## Preflight Connection Check

Rather than letting individual tests fail with cryptic connection errors when the DB is unavailable, a `globalSetup.ts` at the repo root runs a **preflight connection check** before anything else.

If the connection fails, the process exits immediately with a guided error:

```
✖ Integration tests require a running Postgres instance.

  Could not connect to: postgres://localhost:5432/manguito_test

  Start the test database with:
    docker compose up -d

  Then re-run tests:
    pnpm test
```

This follows the project-wide principle of guided error messages — tell the developer what to do next, not just what went wrong.

If the connection succeeds, `globalSetup` proceeds to migrations and seeding.

---

## globalSetup Responsibilities

`globalSetup.ts` runs **once per suite**, before any test file executes. It is never re-run mid-suite.

Steps in order:

1. **Preflight DB connection check** — attempt connection to test DB URL from `.env.test`. Exit with guided error if unavailable.
2. **Run migrations** — call `applyMigrations()` against the test DB. Ensures the schema is up to date before any test runs.
3. **Seed system tables** — call `seedSystemTables()` with `testParsedSchema` from `test-utils/fixtures.ts`. Populates roles and base paths.
4. **Insert role user fixtures** — insert one user per role (admin, manager, editor, writer, viewer) using `testRoleUsers` from `test-utils/fixtures.ts`. These users are available to all tests that need authenticated requests.

These four steps are the only full-suite setup. The DB is not reset between test files.

---

## CI Database Strategy

In CI (GitHub Actions), the test DB is provisioned as a **GitHub Actions service** — a Postgres container managed by GitHub, not by `testcontainers` or Docker CLI commands in the workflow steps.

Key properties:
- DB is fresh at the start of every CI run
- `globalSetup` runs migrations and seeding as normal — same code path as local
- No `testcontainers` dependency needed
- Workflow YAML details are deferred to Phase 10

The decision relevant to Phase 7 is: **integration tests assume a clean DB at the start of each run, and `globalSetup` is solely responsible for migrations and seeding.** No external script, no manual step.

---

## DB Reset Strategy

| Scope | Reset approach |
|-------|---------------|
| Between CI runs | Full clean DB — GitHub Actions provisions a fresh Postgres service |
| Between test files (local) | No reset — DB state carries over |
| Between individual tests | No reset — write tests clean up their own data |
| Mid-suite | Never — `globalSetup` runs once only |

Write tests (any test that creates, updates, or deletes records) are responsible for cleaning up after themselves using `teardownTestData()` from `test-utils/db.ts`. This keeps the suite fast while maintaining predictable state.

---

## Environment Configuration

Test DB connection uses `.env.test` loaded via `dotenv-cli`:

```
DB_URL=postgres://localhost:5432/manguito_test
```

`.env.test` is committed to the repo — it contains no real credentials, only safe local test values. The `pnpm test` script in each package passes this file via `dotenv -e .env.test -- vitest run`.

---

## Vitest Configuration

Root `vitest.config.ts` extended to include `globalSetup`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    globalSetup: './globalSetup.ts',
  },
})
```

Each package inherits this config. Packages that don't need DB access (e.g. `core`) are unaffected — the preflight check is a fast no-op if no integration tests are present in that package's run.
