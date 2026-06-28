---
status: accepted
---

# A distinct smoke-test layer in apps/sandbox verifies the fully assembled system

Smoke tests are a separate layer from unit and integration tests. They live in `apps/sandbox/tests/smoke.test.ts` — the sandbox is the one place every package is wired together as a real application, so it is the natural home for "does the whole thing power on without smoke." They cover only the happy path per major route group (auth flow, content CRUD, config/schema endpoints) plus a single permission-boundary check; exhaustive error codes, field types, and role combinations are integration tests' job. They run last in the Turborepo chain, after all package-level tests pass (`smoke` depends on `test`).

## Considered Options

- **Fold smoke checks into package integration tests** — rejected: catastrophic "nothing assembles" failures only appear when all packages are composed into a running app; a package-level suite tests its package in isolation and would miss them.
- **No smoke layer (rely on integration tests)** — rejected: integration tests are thorough but per-package; a thin full-stack pass is a cheap, high-signal catch for wiring failures before a PR.

## Consequences

- `pnpm test` runs the fast package suites during development; `pnpm smoke` is run deliberately (before opening a PR) — locally optional, automated on `main` in CI (phase 10).
- Smoke tests reuse the same `test-utils` helpers ([0003](./0003-real-postgres-integration-tests.md)); the sandbox config uses a schema matching the `testParsedSchema` fixture shape so fixtures stay compatible.
