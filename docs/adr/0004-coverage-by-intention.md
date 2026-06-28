---
status: accepted
---

# Coverage by intention, not a numeric gate

Test coverage is driven by purpose, not by a percentage threshold. There is no hard coverage gate during development; instead, every public function has at least one test, and every error path in a non-negotiable area is explicitly exercised. Areas are tiered: **Tier 1 (must be thorough)** — the schema parser, auth middleware, permission/hierarchy enforcement, `must_change_password` blocking, and the seeder's dependency guards, because a bug in any of these is a correctness or security failure. **Tier 2 (lighter)** — codegen output, response shapes, slug/pagination/filtering, config defaults. **Tier 3 (minimal/implicit)** — pass-through adapters, thin wiring, generic error codes covered by higher-level tests.

## Considered Options

- **A numeric coverage gate (e.g. 80% lines)** — rejected as the primary measure: it rewards exercising lines over verifying behaviour, and encourages tests written to hit a number rather than to catch real failures. A sanity floor on `main` may be added later (phase 10), but as a floor, not the definition of done.

## Consequences

- Security- and authz-related error codes (`INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `INSUFFICIENT_PERMISSION`, `INSUFFICIENT_PRIVILEGE`, `PASSWORD_CHANGE_REQUIRED`, `RATE_LIMITED`) get explicit dedicated tests; generic ones (`NOT_FOUND`, `VALIDATION_ERROR`) are covered implicitly.
- Snapshot testing is used **only** for codegen string output (`generateSchemaFile`, `generateFormComponent`) — large deterministic strings where "did anything change unexpectedly" is the real question; snapshot updates require a deliberate, reviewed diff. Runtime behaviour (per-field-type serialization, error paths) uses explicit assertions, never snapshots.
