# Decision — Coverage Philosophy and Non-Negotiable Areas

> Testing approach, coverage strategy, and which areas demand thorough coverage.

---

## Coverage Philosophy

Manguito CMS uses **coverage by intention** rather than a numeric coverage gate. Tests are written purposefully to verify behavior that matters — not to satisfy a percentage threshold.

This means:
- No hard coverage percentage enforced during development
- Every public function has at least one test
- Every error path in non-negotiable areas is explicitly exercised
- Tests are written as a correctness guarantee, not a compliance exercise

A numeric coverage gate may be added in Phase 10 when the CI pipeline is wired. If added, it is a sanity floor (e.g. 80% lines on `main` only) — not the primary definition of "done."

---

## Coverage Tiers

### Tier 1 — Must be thorough

Areas where a bug has serious consequences and the logic is complex enough to get wrong. Every error path, every edge case, every permission boundary must have an explicit test.

| Area | Why non-negotiable |
|------|--------------------|
| Schema parser (`core`) | The entire correctness of the system flows from this. Bad parse output silently corrupts codegen, API shapes, and form generation. |
| Auth middleware (`api`) | JWT verification, token_version checking, and cookie handling are security-critical. A bug here exposes the entire admin surface. |
| Permission enforcement (`api`) | `requirePermission` and `requireHierarchy` are the authorization boundary. A gap here means unauthorized access. |
| `must_change_password` logic (`api`) | Blocking behavior that protects forced-temporary-password accounts. Must not be bypassable. |
| Seeder dependency checks (`db`) | The "role in use" and "base path in use" guards prevent destructive data loss. Must reject correctly and with useful error messages. |

### Tier 2 — Should be covered, lighter is fine

Important but straightforward enough that a few well-chosen tests cover the surface. Not every edge case needs a dedicated test.

- Codegen output (correct Drizzle column strings per field type)
- HTTP response shapes (correct envelope, correct status codes)
- Slug handling, pagination, filtering logic
- `defineConfig` default resolution

### Tier 3 — Minimal or covered implicitly

Low complexity, low consequence if wrong, or covered implicitly by higher-level tests. Dedicated tests are not required.

- Simple pass-through adapters
- Thin wiring code that connects already-tested pieces
- Generic error codes (`NOT_FOUND`, `VALIDATION_ERROR`) — covered by other tests

---

## Error Code Coverage

Non-negotiable error codes (auth and permission related) get explicit dedicated test cases:

| Error code | Explicit test required |
|------------|----------------------|
| `INVALID_CREDENTIALS` | Yes — wrong password and unknown email both return same code |
| `TOKEN_EXPIRED` | Yes — clock-advanced test via `vi.useFakeTimers()` |
| `TOKEN_INVALID` | Yes — mismatched token_version after logout or role change |
| `INSUFFICIENT_PERMISSION` | Yes — role without required permission rejected |
| `INSUFFICIENT_PRIVILEGE` | Yes — hierarchy check failure (equal or higher hierarchy_level) |
| `PASSWORD_CHANGE_REQUIRED` | Yes — blocked route returns this code when `must_change_password: true` |
| `RATE_LIMITED` | Yes — login endpoint after threshold |
| `NOT_FOUND` | No — covered implicitly by CRUD tests |
| `VALIDATION_ERROR` | No — covered implicitly by request shape tests |

---

## Snapshot Testing

Snapshot testing is used **only for codegen output** — the string returned by `generateSchemaFile()`.

**Why snapshots for codegen:**
- The output is a large deterministic string
- Writing explicit assertions for every line would be tedious and brittle
- The interesting question is "did anything change unexpectedly" — which snapshots answer directly

**Snapshot discipline:**
- When running `vitest --update-snapshots`, treat the diff review as a mandatory step
- Never commit snapshot updates without reviewing the full diff
- An intentional field type change requires a deliberate snapshot update — this is the intended workflow, not a failure

**What snapshots do NOT cover:**
- Runtime serialization behavior (explicit unit tests per field type)
- Error paths (explicit assertions)
- Any behavior outside codegen string output

---

## Field Type Registry Coverage

The field type registry has two distinct testable surfaces that require different test approaches:

**Codegen (column definitions):** Covered by snapshots of `generateSchemaFile()` output. One snapshot per schema fixture captures all field types simultaneously.

**Serialization (API response shapes):** Covered by explicit unit tests per field type. Each field type needs at least one test verifying its serialized shape in an API response. This is runtime behavior not captured by static string snapshots.

**Unrecognized field type:** One explicit test verifying the system throws a guided error rather than silently producing broken output.
