---
status: accepted
---

# Uniform response envelope and a central ErrorCode catalog in core

Every HTTP response uses one of two envelope shapes: success is `{ ok: true, data, meta? }` (`meta` carries pagination on list endpoints), and failure is `{ ok: false, error: { code, message, details? } }`. Error `code` values are drawn from a single `ErrorCode` union defined in `@bobbykim/manguito-cms-core` and extended phase by phase — never ad-hoc strings at call sites. HTTP status codes are set *in addition* to the envelope, not replaced by it.

## Considered Options

- **Bare payloads / mixed shapes per endpoint** — rejected: clients would need per-endpoint success/error handling; the `ok` discriminant lets one client helper branch uniformly.
- **Per-package error code enums** — rejected: codes appear in API responses, the admin panel's error-message map, and tests; one catalog in core keeps them consistent and greppable across the whole system.

## Consequences

- Adding an endpoint means reusing the envelope and an existing (or newly-cataloged) `ErrorCode`, not inventing a response shape.
- The OpenAPI generator defines the envelope once (`listResponseSchema`/`itemResponseSchema`/`ErrorResponseSchema`) and reuses it across all generated routes.
- This is the HTTP-boundary counterpart to the internal [Result/throw boundary](./0001-throw-vs-result-boundary.md): expected request failures become an `{ ok: false }` envelope, not a thrown exception.
