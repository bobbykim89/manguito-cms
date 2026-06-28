---
status: accepted
---

# Core is the shared kernel: minimal dependencies, deliberately including yaml and bcryptjs

`@bobbykim/manguito-cms-core` is the only package every other package may import, so its dependency set is kept deliberately small. It is **not** Zod-only, despite older wording in CLAUDE.md and a stale comment in `src/index.ts`. Core also depends on `yaml` (to parse schema files — core's primary job) and `bcryptjs` (to provide `hashPassword`/`verifyPassword`). Password hashing lives in core precisely because both `api` (login) and `cli` (`createsuperuser`, `users:promote`) must hash identically, and routing that primitive through core avoids api↔cli coupling or a duplicated implementation.

## Considered Options

- **Zod-only core, hashing in api** — rejected: the CLI would then either depend on api (a forbidden upward import) or reimplement hashing, risking a salt/round mismatch that silently breaks cross-tool logins.
- **A separate `@manguito/crypto` package** — rejected as premature for two functions; core is already the shared kernel both packages import.

## Consequences

- The bar for a new core dependency is high: it must be needed by parsing itself, or be a framework-agnostic primitive that multiple downstream packages must share identically.
- **Drift to fix:** CLAUDE.md's "Add dependencies to manguito-cms-core beyond Zod" prohibition and the `src/index.ts` "no runtime dependencies beyond Zod" comment both predate `yaml`/`bcryptjs` and should be updated to reflect this policy. (`src/index.ts` being a full barrel re-export also contradicts CLAUDE.md's "no barrel index.ts" rule — tracked separately.)
