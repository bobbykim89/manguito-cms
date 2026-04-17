# Decision — Migration Runner

> Defines the dev vs production migration strategy, how Drizzle Kit is wrapped, and the auto-generated `drizzle.config.ts` approach.

---

## Two Modes, Two Commands

Migrations work differently in dev and production. The developer never thinks about this — the CLI picks the right mode based on the command being run.

| Mode | Command | Drizzle Kit command | Migration files | Destructive |
|------|---------|-------------------|-----------------|-------------|
| Dev | `manguito dev` | `drizzle-kit push` | Not generated | Yes — drops removed columns immediately |
| Production | `manguito build` | `drizzle-kit generate` | Generated in `./migrations/` | Only if migration says so |
| Production | `manguito migrate` | `drizzle-kit migrate` | Applied from `./migrations/` | Only if migration says so |

**`drizzle-kit push`** is intentionally destructive in dev — dropping a field from the schema drops the column immediately. This is the desired behavior during development (clean slate is expected). It is never used in production.

**`drizzle-kit generate` + `drizzle-kit migrate`** is the production flow. `generate` creates reviewable SQL migration files. The developer inspects them for unintended destructive changes before running `migrate` to apply them.

---

## Auto-generated `drizzle.config.ts`

Users never write or maintain `drizzle.config.ts`. It is generated automatically from `ResolvedMigrationsConfig` by the CLI before running any Drizzle Kit command.

```ts
// auto-generated — never hand-edited
// written to .manguito/drizzle.config.ts (dev) or dist/drizzle.config.ts (production)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './dist/generated/schema.ts',   // or .manguito/schema.ts in dev
  out: './migrations',                     // from ResolvedMigrationsConfig.folder
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DB_URL! },
  migrationsTable: '__manguito_migrations', // from ResolvedMigrationsConfig.table
})
```

The `__manguito_` prefix on the migrations table name avoids collisions with user-defined content tables in shared Postgres instances.

---

## Migration Runner Functions

The migration runner wraps Drizzle Kit CLI commands by spawning child processes. This is the correct approach — Drizzle Kit is a CLI tool, not a programmatic API, and its internal APIs are not stable.

```ts
// packages/db/src/migrations/index.ts

import { execSync } from 'node:child_process'
import type { MigrationResult, MigrationStatus } from '@bobbykim/manguito-cms-core'
import type { MigrationRunnerOptions, DrizzlePostgresInstance } from '../types'

// Dev mode — fast, destructive, no files generated
export async function runDevMigration(
  configPath: string  // path to the auto-generated drizzle.config.ts
): Promise<void> {
  execSync(`drizzle-kit push --config=${configPath}`, { stdio: 'inherit' })
}

// Production — generate reviewable migration files
export async function generateMigration(
  configPath: string
): Promise<string[]> {
  execSync(`drizzle-kit generate --config=${configPath}`, { stdio: 'inherit' })
  // returns list of generated file paths by reading the migrations folder
  // implementation reads options.migrationsFolder to find new .sql files
  return []  // populated in implementation
}

// Production — apply pending migrations
export async function applyMigrations(
  configPath: string,
  db: DrizzlePostgresInstance,
  options: MigrationRunnerOptions
): Promise<MigrationResult> {
  execSync(`drizzle-kit migrate --config=${configPath}`, { stdio: 'inherit' })
  return getMigrationResult(db, options)
}

// Status — reads migration table directly
export async function getMigrationStatus(
  db: DrizzlePostgresInstance,
  options: MigrationRunnerOptions
): Promise<MigrationStatus> {
  // reads __manguito_migrations table and migration folder
  // returns { applied: string[], pending: string[] }
}
```

---

## getMigrationStatus Implementation

Drizzle Kit maintains a migrations table (default `__manguito_migrations`) that tracks applied migrations by filename. `getMigrationStatus` reads this table alongside the migration folder to compute pending migrations.

```ts
export async function getMigrationStatus(
  db: DrizzlePostgresInstance,
  options: MigrationRunnerOptions
): Promise<MigrationStatus> {
  const { migrationsTable, migrationsFolder } = options

  // 1. get applied migrations from DB
  // the migrations table may not exist yet on first run — handle gracefully
  let applied: string[] = []
  try {
    const result = await db.execute(
      sql.raw(`SELECT migration_name FROM "${migrationsTable}" ORDER BY created_at`)
    )
    applied = result.rows.map((r: any) => r.migration_name as string)
  } catch {
    // table doesn't exist yet — no migrations applied
  }

  // 2. get all migration files from folder
  const fs = await import('node:fs/promises')
  let allFiles: string[] = []
  try {
    const entries = await fs.readdir(migrationsFolder)
    allFiles = entries
      .filter(f => f.endsWith('.sql'))
      .sort()
  } catch {
    // folder doesn't exist yet — no migrations generated
  }

  // 3. compute pending
  const appliedSet = new Set(applied)
  const pending = allFiles.filter(f => !appliedSet.has(f))

  return { applied, pending }
}
```

---

## Layer Responsibilities

The migration runner functions are low-level utilities. The CLI (Phase 9) is responsible for:
- Generating the `drizzle.config.ts` before calling any migration function
- Deciding which migration mode to use based on the command (`dev` vs `build` vs `migrate`)
- Displaying output to the developer

The migration runner functions do not know which CLI command triggered them. They receive a config path and execute the appropriate Drizzle Kit command.

---

## `runMigrations` and `getMigrationStatus` on `DbAdapter`

The `DbAdapter` interface (Phase 2) includes `runMigrations()` and `getMigrationStatus()`. In the Phase 3 adapter implementation these methods throw `"not yet implemented"` because the CLI (Phase 9) is responsible for wiring the config path.

Full wiring happens in Phase 9 when the CLI reads `manguito.config.ts`, generates `drizzle.config.ts`, and calls the migration runner with the correct config path. At that point the adapter's `runMigrations()` and `getMigrationStatus()` methods are replaced with actual implementations.

For Phase 3 integration tests, migration functions are tested directly (not through the adapter interface) using a test-specific config path.
