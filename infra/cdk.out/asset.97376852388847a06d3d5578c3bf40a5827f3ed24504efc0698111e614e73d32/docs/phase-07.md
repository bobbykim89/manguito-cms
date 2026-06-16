# Phase 7 — Testing

> Unit tests, integration tests, and smoke tests across all backend packages.

This phase establishes the complete testing strategy for Manguito CMS. By the end of Phase 6 the full backend is in place — `core`, `db`, and `api` are all functional. Phase 7 consolidates testing into a first-class artifact: a shared test utilities package, a consistent test organization pattern across all packages, and a smoke test suite in `apps/sandbox`.

**Done when:** All unit and integration tests pass across `core`, `db`, and `api`. The `test-utils` package is in place and consumed correctly by `db` and `api`. Smoke tests in `apps/sandbox` cover the happy path for each major route group. The `globalSetup` preflight check correctly detects a missing test DB and exits with a guided error. All non-negotiable areas (schema parser, auth middleware, permission enforcement, `must_change_password` logic, seeder dependency checks) have thorough test coverage.

---

## Decisions Made

| Topic | Detail doc |
|-------|-----------|
| Coverage philosophy and non-negotiable areas | [decisions/phase-07/phase-07-coverage.md](./decisions/phase-07/phase-07-coverage.md) |
| Test organization across the monorepo | [decisions/phase-07/phase-07-organization.md](./decisions/phase-07/phase-07-organization.md) |
| Integration test infrastructure — Docker, CI, globalSetup | [decisions/phase-07/phase-07-infrastructure.md](./decisions/phase-07/phase-07-infrastructure.md) |
| Test data and seed strategy | [decisions/phase-07/phase-07-seed-strategy.md](./decisions/phase-07/phase-07-seed-strategy.md) |
| API integration test strategy | [decisions/phase-07/phase-07-api-tests.md](./decisions/phase-07/phase-07-api-tests.md) |
| Auth-specific test concerns | [decisions/phase-07/phase-07-auth-tests.md](./decisions/phase-07/phase-07-auth-tests.md) |
| Smoke tests | [decisions/phase-07/phase-07-smoke-tests.md](./decisions/phase-07/phase-07-smoke-tests.md) |

---

## Where This Fits

```
Phase 6 — auth module complete, full backend functional

Phase 7 — adds:
  test-utils package        ← shared DB setup, fixtures, request helpers
  core unit tests           ← parser, field type registry, defineConfig
  db unit + integration     ← codegen, seeder, migrations against real Postgres
  api unit + integration    ← route handlers, middleware, auth flows
  apps/sandbox smoke tests  ← happy path per route group, permission boundaries

Phase 8 — admin panel (Vue-specific testing deferred to this phase)
Phase 9 — CLI testing strategy finalized alongside command implementation
Phase 10 — CI workflow wires test suite into GitHub Actions pipeline
```

---

## New Package — `@bobbykim/manguito-cms-test-utils`

```
packages/test-utils/
├── package.json          ← private: true, never published to npm
├── tsconfig.json
└── src/
    ├── db.ts             ← test DB setup, teardown, migration helpers
    ├── fixtures.ts       ← reusable ParsedSchema fixture, seed data shapes
    ├── requests.ts       ← createTestApp(), authenticatedRequest() helpers
    └── index.ts          ← barrel export
```

This package is a private workspace package (`"private": true`). It is never published to npm. It is consumed as a dev dependency by `packages/db` and `packages/api`.

---

## Test Organization Per Package

```
packages/<name>/
├── src/
│   └── <module>/
│       ├── index.ts
│       └── __tests__/
│           └── <module>.test.ts    ← unit tests beside source
└── tests/
    └── integration.test.ts         ← integration tests at package root

apps/sandbox/
└── tests/
    └── smoke.test.ts               ← full-stack smoke tests
```

Unit tests live beside the source they test. Integration tests live at the package root. Smoke tests live in `apps/sandbox`.

---

## globalSetup Responsibilities

A single `globalSetup.ts` at the repo root runs once before the entire test suite:

1. **Preflight DB connection check** — attempts connection to test DB; exits with a guided error if unavailable
2. **Run migrations** — applies all pending migrations against the test DB
3. **Seed system tables** — calls `seedSystemTables()` with the test config fixture
4. **Insert role user fixtures** — creates one user per role (admin, manager, editor, writer, viewer)

These steps run once per suite. The DB is never fully reset mid-suite.

---

## Developer Checklist

### Setup
- [ ] Create `packages/test-utils/` with `package.json` (`private: true`), `tsconfig.json`, `src/index.ts`
- [ ] Add `@bobbykim/manguito-cms-test-utils` as a dev dependency in `packages/db/package.json`
- [ ] Add `@bobbykim/manguito-cms-test-utils` as a dev dependency in `packages/api/package.json`
- [ ] Create `globalSetup.ts` at repo root
- [ ] Verify Docker Compose test DB config from Phase 3 is in place
- [ ] Add `.env.test` with `DB_URL` pointing to test container if not already present

### test-utils package — see [phase-07-organization.md](./decisions/phase-07/phase-07-organization.md) and [phase-07-api-tests.md](./decisions/phase-07/phase-07-api-tests.md)
- [ ] `db.ts` — test DB connection helper, teardown utility
- [ ] `fixtures.ts` — minimal but realistic `ParsedSchema` fixture, role user seed shapes
- [ ] `requests.ts` — `createTestApp()` factory, `authenticatedRequest()` helper
- [ ] `index.ts` — barrel export of all utilities

### globalSetup — see [phase-07-infrastructure.md](./decisions/phase-07/phase-07-infrastructure.md)
- [ ] Preflight check — attempts DB connection, exits with guided error if unavailable
- [ ] Runs migrations against test DB
- [ ] Calls `seedSystemTables()` with test config fixture
- [ ] Inserts one user per role — admin, manager, editor, writer, viewer

### core package tests — see [phase-07-coverage.md](./decisions/phase-07/phase-07-coverage.md)
- [ ] Unit: schema parser — valid schemas for all four types
- [ ] Unit: schema parser — all `ParseErrorCode` error paths
- [ ] Unit: field type registry — correct Drizzle column string per field type (snapshot)
- [ ] Unit: field type registry — correct serialization shape per field type (explicit assertions)
- [ ] Unit: field type registry — unrecognized field type throws guided error
- [ ] Unit: `defineConfig` — default resolution, partial overrides
- [ ] Unit: roles parser — valid roles, duplicate hierarchy, unknown permissions

### db package tests — see [phase-07-coverage.md](./decisions/phase-07/phase-07-coverage.md)
- [ ] Unit: codegen — all field types produce correct Drizzle column strings (snapshot)
- [ ] Unit: codegen — junction tables including self-referencing content type
- [ ] Unit: codegen — paragraph topological ordering
- [ ] Unit: codegen — enum check constraints
- [ ] Unit: codegen — system tables hardcoded output
- [ ] Unit: seeder dependency check — role in use blocks deletion with user emails listed
- [ ] Unit: seeder dependency check — base path in use blocks deletion with details
- [ ] Integration: adapter connect / disconnect / tableExists / getTableNames
- [ ] Integration: seeder full sync cycle — insert, update, delete
- [ ] Integration: seeder dryRun — no writes, correct result counts
- [ ] Integration: migrations — `applyMigrations` and `getMigrationStatus`

### api package tests — see [phase-07-api-tests.md](./decisions/phase-07/phase-07-api-tests.md) and [phase-07-auth-tests.md](./decisions/phase-07/phase-07-auth-tests.md)
- [ ] Unit: `buildRolesRegistry` — throws on empty array, missing system role, duplicate hierarchy_level
- [ ] Unit: `requirePermission` — allows correct role, rejects insufficient role
- [ ] Unit: `requireHierarchy` — allows lower hierarchy_level, rejects equal or higher
- [ ] Unit: `mustChangePasswordCheck` — blocks non-change-password routes, allows change-password route
- [ ] Unit: `authMiddleware` — rejects missing token, invalid signature, mismatched token_version
- [ ] Unit: `authMiddleware` — proactive refresh issued when token expires within 30 minutes
- [ ] Unit: login — `INVALID_CREDENTIALS` for wrong password and unknown email
- [ ] Unit: login — `RATE_LIMITED` after threshold
- [ ] Integration: auth flow — login issues cookies, refresh reissues auth_token, logout clears cookies
- [ ] Integration: expired token rejected — use `vi.useFakeTimers()` to advance clock
- [ ] Integration: token_version mismatch rejected after logout or role change
- [ ] Integration: `must_change_password` blocks all routes except change-password
- [ ] Integration: content CRUD — create, read, update, delete cycle in natural order
- [ ] Integration: permission boundary — unauthorized role rejected on protected route
- [ ] Integration: `GET /admin/api/config` — returns sanitized config, no sensitive fields
- [ ] Integration: `GET /admin/api/schema` — returns full schema definitions

### Smoke tests — see [phase-07-smoke-tests.md](./decisions/phase-07/phase-07-smoke-tests.md)
- [ ] Auth flow — login, refresh, logout happy path
- [ ] Content CRUD — create, read, update, delete one content item
- [ ] Permission boundary — unauthorized role rejected on at least one protected route per route group
- [ ] Config and schema endpoints return valid responses
- [ ] Server responds to requests (basic liveness check)

---

## Tests

### Snapshot discipline
When running `vitest --update-snapshots`, treat the diff review as a required step — never accept snapshot updates without reviewing the full diff. Snapshots are used for codegen output only (`generateSchemaFile()` output strings).

### Write test cleanup
Any test that creates, updates, or deletes data must clean up after itself. The DB is not reset between test files — only between CI runs.

### Clock mocking
Use `vi.useFakeTimers()` for JWT expiry tests. Always call `vi.useRealTimers()` in `afterEach` to prevent fake clock state from leaking into subsequent tests.

---

## Claude Code Checklist

- [ ] Read all detail docs linked in the Decisions Made table before implementing
- [ ] `test-utils` is `private: true` — confirm it is never added to the `files` array or published
- [ ] `globalSetup.ts` must exit the process with a non-zero code and a guided error message if the DB connection fails — do not let individual tests fail with cryptic connection errors
- [ ] `createTestApp()` must accept `ParsedSchema` and a DB connection — never read `manguito.config.ts` from disk in tests
- [ ] `authenticatedRequest()` constructs a pre-signed JWT — never call the login endpoint to obtain a token in integration tests
- [ ] `vi.useFakeTimers()` must always be paired with `vi.useRealTimers()` in `afterEach` — never leave fake timers active between tests
- [ ] Snapshot updates require diff review — do not run `--update-snapshots` and commit without reviewing the diff
- [ ] Write tests must clean up their own data — never assume a full DB reset between test files
- [ ] Admin package test strategy is deferred to Phase 8 — do not add Vue component tests here
- [ ] CLI test strategy is deferred to Phase 9 — do not add CLI tests here
- [ ] CI workflow wiring is deferred to Phase 10 — do not create `.github/workflows/` files here
