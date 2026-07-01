---
status: accepted
---

# ORM-agnostic routes via a ContentRepository interface injected into the API

Route handlers never touch the ORM. They depend on the `ContentRepository<T>` interface defined in `@bobbykim/manguito-cms-core`; the concrete Drizzle implementation — `createDrizzleContentRepository` — lives in `@bobbykim/manguito-cms-api` (`src/repositories/content.ts`) and imports only the `DrizzlePostgresInstance` *type* from `@bobbykim/manguito-cms-db`. `createCmsApp` constructs the repositories from the injected db adapter and hands each handler a `ContentRepository<T>`, so no route imports Drizzle. This keeps the API layer ORM-agnostic: swapping Postgres for another store is a new repository implementation behind the same interface, not a rewrite of every handler.

## Considered Options

- **Query the ORM directly in handlers** — rejected: couples every route to Drizzle and makes the planned Postgres→other-store swap a breaking change across the whole route layer.
- **Put the repository implementation in `@bobbykim/manguito-cms-db`** — not taken: the repository is Postgres/Drizzle-specific and only needs db's *connection type*, so it lives in api beside the routes that consume it, while db stays a thin adapter and core stays ORM-free. The boundary that matters — routes depend on the core interface, never the ORM — holds regardless of which package holds the implementation.
- **Put relational specifics (junction tables, paragraph persistence) on the core interface** — rejected: those are Postgres-shaped and would leak into the ORM-agnostic seam; relation read/write stays in api (`packages/api/src/repositories/content.ts` and `packages/api/src/relations.ts`), not on `ContentRepository<T>`.

## Consequences

- The N+1 problem is solved inside the repository (dataloader-style batched `WHERE id IN (...)`), invisible to handlers; pagination's 1-indexed `page`→`OFFSET` translation also lives there.
- Generated content/taxonomy routes get their permission from an HTTP-method→permission map applied in the route generator (`GET`→`read`, `POST`→`create`, `PATCH`→`edit`, `DELETE`→`delete`); user-management routes are hand-authored and wire permissions explicitly.
- Routes are generated to `.manguito/` (dev) or `dist/generated/` (build) and assembled from primitives the api package exports — the api provides the parts, the CLI generates the assembly.
- **Drift corrected:** earlier wording placed the concrete repository in `@bobbykim/manguito-cms-db` and rejected "define the repository in api." That was inaccurate — the implementation has always been in api; this ADR now matches the code.
