# Decision — Schema Drift Detection at Startup

> Defines how `manguito start` detects and responds to unapplied migrations at production startup.

---

## The Problem

Schema drift occurs when a developer edits a schema file but deploys without running `manguito migrate` first. The running application then operates against a DB structure that doesn't match the current schema — a mismatch that can cause silent failures or runtime errors that are hard to diagnose.

---

## Detection Strategy

`manguito start` performs a migration state check on every startup. The check runs after the DB connection is established, before the Hono server begins accepting requests.

Two distinct scenarios require different responses:

---

### Scenario A — Migration table does not exist

The `__manguito_migrations` tracking table is absent. This means `manguito migrate` has never been run against this database. The application cannot start safely.

**Behavior: block.**

```
✖ Database has not been initialized.
  Run `manguito migrate` first to set up the database, then try again.
```

Execution stops. The server does not start.

---

### Scenario B — Pending migrations exist

The tracking table exists but some migration files in `./migrations/` have not been applied. The DB is partially out of date.

**Behavior: warn and continue.**

```
⚠ There are pending migrations that have not been applied:
  - 0004_add_blog_post_summary.sql

  Run `manguito migrate` to apply them.
  Continuing startup — proceed at your own risk.
```

The server starts normally after printing the warning. This is non-blocking because the application may still function correctly depending on which fields changed, and blocking here would prevent operators from starting the server to diagnose issues.

---

### Scenario C — All migrations applied

No pending migrations. Clean start, no message printed.

---

## Startup Check Sequence

```
manguito start
  ↓
Load env (--env flag if provided)
  ↓
Establish DB connection
  → connection fails: clear error, stop
  ↓
Check __manguito_migrations table exists
  → does not exist: block with guided error (Scenario A)
  ↓
Call getMigrationStatus()
  → pending migrations found: warn, continue (Scenario B)
  → all applied: clean start (Scenario C)
  ↓
Run seedSystemTables (roles + base paths sync)
  ↓
Start Hono server
```

Note: the seeder runs on every startup regardless of migration state (when not blocked). The seeder is idempotent — re-seeding an already-seeded DB produces no changes.

---

## Rationale for Warn-Not-Block on Pending Migrations

Blocking on pending migrations at startup is the strictest stance (Django does this). However for Manguito CMS:

- It would prevent operators from starting a running application to diagnose production issues if a migration was accidentally not applied.
- Manguito CMS targets developers who own their deployment pipeline — they are expected to run `manguito migrate` as part of their deploy process, not rely on the server to enforce it.
- The warning is prominent and specific enough to be actionable.

The harder block (Scenario A) is reserved for the case where the DB has never been initialized at all — a situation where the server genuinely cannot function.

---

## Dev Mode

This startup check does **not** apply to `manguito dev`. In dev mode, `drizzle-kit push` keeps the DB in sync automatically on every schema file change. There is no `__manguito_migrations` table in dev.
