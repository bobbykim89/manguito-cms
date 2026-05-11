# Decision — Smoke Tests

> Scope, location, structure, and run order for smoke tests.

---

## Purpose

Smoke tests verify that the whole system hangs together end-to-end. They do not replace unit or integration tests — they complement them by catching catastrophic failures that only appear when all pieces are assembled together.

The name comes from hardware testing: power something on and check if smoke comes out before doing anything else. A passing smoke suite means the system is alive and the major flows are not broken.

---

## Location — `apps/sandbox`

Smoke tests live in `apps/sandbox/tests/smoke.test.ts`.

`apps/sandbox` is already the "full stack assembled" environment — it exists specifically as a local test harness where all packages are wired together. Smoke tests are a natural fit here rather than a forced addition to a package-level test suite.

```
apps/sandbox/
├── package.json
├── manguito.config.ts    ← sandbox config (uses testParsedSchema shape)
└── tests/
    └── smoke.test.ts     ← smoke test suite
```

---

## Scope

Smoke tests cover the **happy path per major route group** plus **one permission boundary check**.

| Area | What is verified |
|------|-----------------|
| Liveness | Server responds to a request — not a 500 |
| Auth flow | Login returns cookies, refresh reissues auth_token, logout clears cookies |
| Content CRUD | Create, read, update, delete one content item — all return expected status codes |
| Config endpoint | `GET /admin/api/config` returns `ok: true` with expected fields |
| Schema endpoint | `GET /admin/api/schema` returns `ok: true` with schema data |
| Permission boundary | One unauthorized role rejection per route group |

Smoke tests do not verify:
- Every error code
- Every field type
- Edge cases
- Permission boundary for every role combination

That is integration tests' job.

---

## Structure

```ts
// apps/sandbox/tests/smoke.test.ts

describe('smoke — auth', () => {
  it('login returns cookies and user info')
  it('refresh reissues auth_token')
  it('logout clears cookies')
})

describe('smoke — content CRUD', () => {
  it('creates a content item')
  it('reads the content item')
  it('updates the content item')
  it('deletes the content item')
})

describe('smoke — permission boundary', () => {
  it('viewer cannot create content — INSUFFICIENT_PERMISSION')
})

describe('smoke — internal endpoints', () => {
  it('GET /admin/api/config returns sanitized config')
  it('GET /admin/api/schema returns schema data')
})
```

---

## Run Order

Smoke tests run **after all package-level tests pass** — last in the Turborepo task chain.

```json
// turbo.json — smoke task depends on all package tests passing
{
  "tasks": {
    "test": {
      "dependsOn": ["^build"]
    },
    "smoke": {
      "dependsOn": ["test"],
      "cache": false
    }
  }
}
```

`pnpm test` runs package-level tests. `pnpm smoke` (or a separate turbo task) runs smoke tests after. This separation means developers can run the fast suite during development and only run smoke when they want full-stack verification.

---

## Local vs CI

**Locally:** Smoke tests are optional — run deliberately, not on every save. A developer finishing a feature runs `pnpm smoke` before opening a pull request.

**CI (Phase 10):** Smoke tests run automatically after all package tests pass on `main`. Details deferred to Phase 10.

---

## Test Utilities

Smoke tests consume the same `test-utils` helpers as API integration tests:

- `createTestApp()` — constructs the wired Hono app instance
- `authenticatedRequest()` — pre-signed JWT requests for role-specific flows
- `teardownTestData()` — cleanup for content items created during smoke tests

The sandbox `manguito.config.ts` uses a schema that matches `testParsedSchema` shape so fixtures are compatible.
