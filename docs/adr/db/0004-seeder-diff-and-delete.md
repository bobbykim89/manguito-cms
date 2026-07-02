---
status: accepted
---

# System-table seeding is idempotent diff-and-delete with dependency guards — fail loud, never auto-reassign

`seedSystemTables` syncs the `roles` and `base_paths` tables from schema files (`roles.json`, `routes.json`) on every startup. It is idempotent — safe to re-run against a populated DB, so no first-run detection is needed — and it does a full **diff-and-delete**, not a pure upsert: rows removed from the schema files are removed from the DB. Before deleting, it checks for dependents (users assigned to a role, content using a base path) and, if any exist, **throws an actionable error** (`SEEDER_ROLE_IN_USE`, `SEEDER_BASE_PATH_IN_USE`) instead of cascading or reassigning. Roles stored with `is_system` are additionally protected: removing one from `roles.json` throws `SEEDER_SYSTEM_ROLE` regardless of dependents, because silently deleting a built-in role (e.g. `admin`) could lock everyone out. To retire a system role deliberately, re-seed it with `is_system: false` first, then remove it. A `dryRun` mode runs all checks and reports what would change without writing.

## Considered Options

- **Pure upsert (no delete)** — rejected: removing a role from `roles.json` would leave a stale row in the DB forever; the schema files would stop being the source of truth.
- **Auto-reassign / cascade on delete** — rejected as dangerous: silently moving users to another role or rewriting content's base path without developer intent is exactly the kind of data change that must be explicit. v1 deliberately has no automated migration path here.

## Consequences

- A blocked delete is a developer task: reassign the users or update the content, then re-run. The error message names exactly what blocks it.
- The throws here are lifecycle guards, conforming to the [throw-vs-Result boundary](../0001-throw-vs-result-boundary.md), not control-flow failures.
- Dependency checks use `information_schema` discovery + raw SQL counts because the generated Drizzle schema for user tables may not be loaded when the seeder runs.
