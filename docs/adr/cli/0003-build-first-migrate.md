---
status: accepted
---

# migrate depends on build: always-fresh artifacts, build never touches the DB, seed runs after migrate atomically

`manguito migrate` always runs `manguito build` as its first step, then `drizzle-kit generate` → destructive-change scan → `drizzle-kit migrate` → `seedSystemTables`. The dependency is one-directional: migrate knows about build, build knows nothing about migrate and never touches the database. This exists because there is no path from schema JSON to the DB except through `dist/generated/schema.ts` — so the migration must be generated from a *fresh* build, never stale `.manguito/` dev ephemera or a previous `dist/`. To avoid needless rebuilds, migrate uses an mtime check (any file under `schemas/` newer than `dist/generated/schema.ts`, or the artifact missing → rebuild; otherwise skip). Seeding runs after migrations in the same command so roles and base paths are always in sync with the schema files when migrate completes.

## Considered Options

- **Require the developer to `build` before `migrate`** — rejected: a forgotten build silently generates migrations from stale schema; making migrate own the build removes that whole class of error.
- **Reuse existing artifacts unconditionally** — rejected: risks migrating against an outdated schema. The mtime check keeps it cheap without sacrificing freshness.
- **Separate `migrate` and `seed` commands** — rejected: roles/base_paths must match the deployed schema after every deploy; running them as one atomic step guarantees a consistent post-migrate DB.

## Consequences

- `migrate --status` is read-only and never triggers a build; `--dry-run` builds and prints SQL but writes nothing; `--force` skips the destructive-change prompt but never silences the warning (the scan from [db 0002](../db/0002-two-mode-migrations.md) still runs).
- Migrations are forward-only — rollback is a new forward migration, not an undo.
- `build` remains independently runnable for non-DB changes (config tweak, UI change) since it has no DB knowledge.
