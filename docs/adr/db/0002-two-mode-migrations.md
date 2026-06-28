---
status: accepted
---

# Two-mode migrations: destructive push in dev, reviewable generate+migrate in prod

Migrations run in two modes the developer never selects manually — the CLI picks based on the command. `manguito dev` runs `drizzle-kit push`, which is **intentionally destructive**: removing a field from the schema drops the column immediately, because a clean slate is the desired dev behaviour. Production uses `drizzle-kit generate` (produces reviewable `.sql` files) followed by `drizzle-kit migrate` (applies them). Before a production apply, the destructive-change scanner inspects the newly generated files for `DROP COLUMN` / `DROP TABLE` / `ALTER COLUMN ... TYPE` and reports them so the CLI can require confirmation. All three Drizzle Kit commands are invoked as **child processes**, not via a programmatic API.

## Considered Options

- **One migration mode for both** — rejected: dev wants fast, throwaway, destructive syncs; production wants reviewable, safe, file-tracked changes. Forcing either onto the other is wrong for that environment.
- **Call Drizzle Kit's internal/programmatic API** — rejected: Drizzle Kit is a CLI tool whose internal APIs are not stable; shelling out to the documented CLI is the supported contract.
- **Auto-apply destructive migrations in prod** — rejected: data loss must be a deliberate, confirmed developer action; the scanner exists to make destruction visible, not automatic.

## Consequences

- `push` must never run against production — the mode split is a safety boundary, not a convenience.
- The scanner only inspects the files passed to it (the current run's newly generated migrations), decides nothing, and connects to no DB — it returns findings and the CLI (phase 9) owns the warning/confirmation/`--force` behaviour.
- `drizzle.config.ts` is auto-generated from the resolved migrations config before any command runs; users never hand-maintain it. The `__manguito_` migrations-table prefix avoids collisions in shared Postgres instances.
