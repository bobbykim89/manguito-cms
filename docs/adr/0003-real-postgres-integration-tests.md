---
status: accepted
---

# Integration tests run against a real Postgres — the DB is never mocked

Backend integration tests exercise a real Postgres test database; the DB layer is never mocked. The interesting bugs in a CMS live at the route-handler↔DB boundary — permission checks against real role rows, slug uniqueness, reference integrity — and mocking the DB would turn those tests into theatre while hiding real production failures. Tests do not start an HTTP server: they call into the Hono app directly via `app.request()` (fast, no port conflicts). Authentication uses pre-signed JWTs through `authenticatedRequest()` rather than calling the login endpoint, which would be slow and couple every test to the login implementation.

## Considered Options

- **Mock the DB / repository layer** — rejected: the correctness guarantees that matter (authz, integrity, uniqueness) only exist against a real schema with real constraints; mocks would assert against a fiction.
- **Spin up a real HTTP server per test** — rejected: slower and prone to port conflicts in CI; `app.request()` gives the same coverage in-process.
- **Log in over HTTP in every test** — rejected: couples tests to login + rate limiting and is needlessly slow; a signed JWT is equivalent.

## Consequences

- A once-per-suite `globalSetup.ts` owns all full-suite state: preflight DB connection check (guided error if unreachable), `applyMigrations()`, `seedSystemTables()`, and inserting one user per role. The DB is **not** reset between test files; write tests clean up after themselves via `teardownTestData()`. CI provisions a fresh Postgres service so every run starts clean.
- The five role-user fixtures and the system seed are never mutated by tests — tests needing unusual state (e.g. `must_change_password`, a bumped `token_version`) create throwaway users and tear them down.
- Shared test infrastructure lives in a private (`private: true`, never published) workspace package `@bobbykim/manguito-cms-test-utils` rather than a loose folder, so imports are clean named imports and Turborepo models build-before-test ordering correctly. `createTestApp` wires a deterministic Hono app from fixture data, never reading `manguito.config.ts` from disk.
- The in-memory rate limiter means rate-limit tests need a fresh `createTestApp()` instance to avoid state bleed ([api 0005](./api/0005-in-process-rate-limiting.md)).
