---
status: accepted
---

# Drizzle stays private behind a getDb() closure; PostgresAdapter is never exported

`createPostgresAdapter` returns an object typed publicly as core's `DbAdapter`, which has no Drizzle knowledge. Internally it holds the Drizzle instance in its closure and exposes it through `getDb()`, declared on an extended `PostgresAdapter = DbAdapter & { getDb(): DrizzlePostgresInstance }` type that lives in `db/src/types.ts` and is **not** exported from the package's public surface. Only `db`-internal modules (seeder, repositories) import `PostgresAdapter` and call `getDb()`; external callers (api, cli) hold a `DbAdapter` and never see Drizzle. This is what lets the API run queries without importing the ORM, keeping the boundary that [core 0001](../core/0001-adapter-interfaces-in-core.md) defines.

## Considered Options

- **Expose the Drizzle instance on the public `DbAdapter`** — rejected: every consuming package would couple to `drizzle-orm`, collapsing the layer graph.
- **Define a repository interface in core** — rejected for v1: core would have to model query capabilities it has no reason to know about; the closure keeps the ORM entirely inside `db`.

The pattern is NestJS's `onModuleInit` + `get db()` expressed as a factory + closure rather than a class, per CLAUDE.md's "factory functions over classes."

## Consequences

- The `getDb()` method existing only on an internal type is deliberate — a reader who can't find it on `DbAdapter` is meant to find it inside `db` only.
- **Drift:** `DrizzlePostgresInstance` is currently re-exported from `db/src/index.ts`, which the decision doc said should never happen. Exporting the bare Drizzle *instance type* is more defensible than exporting `PostgresAdapter` (it types the seeder signature consumers pass through), but it widens the surface beyond what was intended — reconcile by either keeping it deliberately (and updating the doc) or moving it back to internal-only.
