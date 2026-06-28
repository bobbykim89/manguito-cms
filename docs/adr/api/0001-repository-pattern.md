---
status: accepted
---

# ORM-agnostic routes via a ContentRepository interface injected into the API

Route handlers never touch the ORM. They depend on the `ContentRepository<T>` interface defined in `@bobbykim/manguito-cms-core`; the concrete `DrizzleContentRepository` lives in `@bobbykim/manguito-cms-db`. The api package imports the interface only — `createAPIAdapter` receives the db adapter and constructs repositories internally, so api never imports Drizzle or `DrizzleContentRepository` directly. This keeps the API layer ORM-agnostic: swapping Postgres for another store is a new repository implementation, not a rewrite of every handler.

## Considered Options

- **Query the ORM directly in handlers** — rejected: couples every route to Drizzle and makes the planned Postgres→other-store swap a breaking change across the whole route layer.
- **Define the repository in api** — rejected: the interface must be visible to both db (implementer) and api (consumer) without api↔db type coupling; core is the shared home, consistent with [core 0001](../core/0001-adapter-interfaces-in-core.md) and [db 0001](../db/0001-drizzle-private-behind-getdb.md).

## Consequences

- The N+1 problem is solved inside the repository (dataloader-style batched `WHERE id IN (...)`), invisible to handlers; pagination's 1-indexed `page`→`OFFSET` translation also lives there.
- Generated content/taxonomy routes get their permission from an HTTP-method→permission map applied in the route generator (`GET`→`read`, `POST`→`create`, `PATCH`→`edit`, `DELETE`→`delete`); user-management routes are hand-authored and wire permissions explicitly.
- Routes are generated to `.manguito/` (dev) or `dist/generated/` (build) and assembled from primitives the api package exports — the api provides the parts, the CLI generates the assembly.
