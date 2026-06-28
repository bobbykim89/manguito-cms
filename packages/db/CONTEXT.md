# Db

The persistence layer of Manguito CMS. It implements core's `DbAdapter` for Postgres, generates the Drizzle schema from the parsed registry, runs migrations, and seeds the system tables. It imports only from core. See [docs/adr/db](../../docs/adr/db) for the decisions that shape it.

## Language

### Adapter internals

**Postgres adapter**:
The factory-produced `DbAdapter` implementation for Postgres. Holds the Drizzle instance privately in its closure and exposes it only to db-internal callers via `getDb()`.
_Avoid_: connection, client, pool (those are its parts, not the adapter)

**getDb()**:
The internal-only accessor that hands a connected Drizzle instance to db-internal modules. Absent from the public `DbAdapter` surface by design.
_Avoid_: getConnection, getClient

### Schema generation

**Generated schema**:
The Drizzle schema TypeScript file produced from the `SchemaRegistry` by codegen — written to `.manguito/` in dev, `dist/generated/` in build. A build artifact, never hand-edited.
_Avoid_: models, entities, ORM definitions

**System table**:
A table not derived from any user schema — `media`, `base_paths`, `roles`, `users` — hardcoded in codegen and always identical.
_Avoid_: built-in table, core table

**Junction table**:
The link table generated for a `many-to-many` reference field, cascading on both sides.
_Avoid_: pivot table, join table, bridge table

### Migrations and seeding

**Push**:
The dev migration mode (`drizzle-kit push`) — fast, fileless, and intentionally destructive. Never used in production.
_Avoid_: sync, dev migrate

**Migration (generated)**:
A reviewable `.sql` file produced by `drizzle-kit generate` for production and applied by `drizzle-kit migrate`.
_Avoid_: change script, patch

**Destructive change**:
A `DROP COLUMN`, `DROP TABLE`, or `ALTER COLUMN ... TYPE` in a generated migration — the operations the scanner flags before a production apply.
_Avoid_: breaking change, data loss op

**Seeding**:
Populating the `roles` and `base_paths` system tables from schema files on startup. Diff-and-delete and idempotent — distinct from migrations, which create structure.
_Avoid_: bootstrapping, fixtures, initialization

**Dependency guard**:
The seeder's refusal to delete a role or base path that still has dependents (assigned users, content using it), reported as an actionable error rather than a cascade.
_Avoid_: constraint check, validation
