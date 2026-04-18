# Decision — `manguito migrate` Command

> Defines the full surface area of the migrate command, its flags, execution order, and the build-first contract.

---

## Command Surface Area

```
manguito migrate                # standard deploy command
manguito migrate --status       # read-only migration state
manguito migrate --dry-run      # preview only, no writes
manguito migrate --force        # skip destructive change confirmation
manguito migrate --env <file>   # target environment via dotenv file
```

Flags can be combined where it makes sense:

```
manguito migrate --dry-run --env .env.staging
manguito migrate --force --env .env.production
manguito migrate --status --env .env.staging
```

---

## `manguito migrate` — Standard Flow

This is the command a developer runs on every production deploy. It is a single safe operation that handles the full migration lifecycle.

```
1. Load env from --env file if provided (dotenv-cli)
2. Read and resolve manguito.config.ts
3. Run manguito build → fresh dist/generated/schema.ts
   → if build fails: surface build error with details, stop
4. Run drizzle-kit generate → writes SQL files to ./migrations/
5. Call scanMigrationFiles() on newly generated files
   → see phase-04-destructive-changes.md for scanner behavior
   → if destructive ops found and not --force: print warning, prompt confirmation
   → if destructive ops found and --force: print warning, skip prompt
6. Apply pending migrations via drizzle-kit migrate
7. Run seedSystemTables (roles + base paths sync)
8. Print result summary
```

### Why build-first?

`manguito migrate` always calls `manguito build` internally as its first step. It never reuses artifacts from `.manguito/` (dev ephemera) or a previous `dist/generated/` run.

This guarantees the schema used to generate migrations always reflects the current state of the schema files — not a potentially stale previous build. A developer should never have to remember to build before migrating.

### Why seeder runs after migrations?

Migrations and seeding are not separable in the migrate command. Roles and base paths live in system tables that must be in sync with `roles.json` and `routes.json` after every deploy. Running them together as one atomic operation means the DB is always in a consistent state after `manguito migrate` completes.

### Result output

```
✔ Build complete
✔ Generated 1 migration file: 0004_add_blog_post_summary.sql
✔ Applied 1 migration
✔ Seeder: 0 inserted, 2 updated, 0 deleted (roles)
✔ Seeder: 0 inserted, 1 updated, 0 deleted (base_paths)
```

---

## Destructive Change Warning Format

When `scanMigrationFiles()` returns destructive operations:

```
⚠ This migration contains destructive operations:
  - DROP COLUMN blog_post.summary
  - DROP TABLE paragraph_photo_card

  These changes are irreversible and may cause data loss.
  Review ./migrations/0004_update_blog_post.sql before continuing.

  Apply anyway? (yes/N):
```

The developer must type `yes` exactly to continue. Any other input cancels and exits without applying.

With `--force`:

```
⚠ This migration contains destructive operations:
  - DROP COLUMN blog_post.summary

  Proceeding automatically (--force).
```

`--force` never silences the warning — it only bypasses the interactive prompt. CI/CD pipeline logs always contain a record of destructive operations applied.

---

## `manguito migrate --status`

Read-only. No writes of any kind. Does not run build or generate.

Cross-references `__manguito_migrations` tracking table with `./migrations/meta/_journal.json`.

```
Applied migrations:
  ✔ 0001_initial_schema.sql        (2024-01-15 10:32:00)
  ✔ 0002_add_taxonomy_tables.sql   (2024-02-03 14:21:00)
  ✔ 0003_add_media_fields.sql      (2024-03-10 09:05:00)

Pending migrations:
  ○ 0004_add_blog_post_summary.sql

Run `manguito migrate` to apply pending migrations.
```

If no `./migrations/` folder or journal exists:

```
No migration files found. Run `manguito migrate` to generate and apply migrations.
```

---

## `manguito migrate --dry-run`

Runs the build and generate steps, prints the generated SQL to the terminal, then stops. Nothing is written to `./migrations/`, nothing is applied to the DB, the seeder does not run.

```
Dry run — no files will be written, no changes applied.

Generated SQL:
──────────────────────────────────────────
ALTER TABLE "blog_post" ADD COLUMN "summary" text;
──────────────────────────────────────────

No destructive operations detected.

Run `manguito migrate` to generate and apply this migration.
```

If destructive operations are found during dry-run, they are highlighted — same warning format but no confirmation prompt since nothing is being applied.

---

## Migration File Location and Naming

Migration files are written to `./migrations/` at the project root. This folder is committed to version control.

File naming follows Drizzle Kit's default convention — zero-padded sequential index plus an auto-generated descriptive tag:

```
migrations/
├── 0001_initial_schema.sql
├── 0002_add_taxonomy_tables.sql
└── meta/
    └── _journal.json
```

---

## Rollback Strategy

Schema migrations are forward-only. Rollback is not supported. To undo a migration, write a new forward migration that reverses the change.

---

## Separation from `manguito build`

| Command | Purpose | Touches DB |
| ------- | ------- | ---------- |
| `manguito build` | Produces `dist/` artifacts for deployment | No |
| `manguito migrate` | Applies schema changes to the DB | Yes |

`manguito migrate` calls `manguito build` internally, but a developer can also run `manguito build` alone without touching the DB.
