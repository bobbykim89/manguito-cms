---
status: accepted
---

# manguito start blocks on an uninitialized DB but only warns on pending migrations

At production startup, `manguito start` checks migration state after connecting to the DB and before accepting requests, with two different responses. If the `__manguito_migrations` table is absent — the DB was never initialized — it **blocks**: the server refuses to start and points the operator at `manguito migrate`. If the table exists but migration files are unapplied — the DB is merely out of date — it **warns and continues**: it prints the pending migrations and starts anyway. The seeder runs on every (non-blocked) startup, idempotently.

## Considered Options

- **Block on pending migrations too (Django's stance)** — rejected: it would stop an operator from starting a running app to diagnose a production issue when a migration was missed. Manguito targets developers who own their deploy pipeline and are expected to run `migrate` as part of it; a prominent, specific warning is enough.
- **Warn on everything, block on nothing** — rejected: a DB with no migration table genuinely cannot serve requests; starting it would only produce confusing downstream errors, so that one case blocks.

## Consequences

- The block is reserved for "cannot function at all"; everything short of that is operator-recoverable and therefore non-blocking.
- This check does not apply to `manguito dev`, which keeps the DB in sync via `drizzle-kit push` and has no `__manguito_migrations` table.
