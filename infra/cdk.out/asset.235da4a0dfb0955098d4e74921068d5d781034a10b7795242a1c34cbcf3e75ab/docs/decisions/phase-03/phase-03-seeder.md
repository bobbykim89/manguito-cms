# Decision — System Table Seeding

> Defines the `seedSystemTables` function — how roles and base paths are kept in sync with schema files, including idempotent upsert, diff-and-delete, dependency checks, and dry run mode.

---

## What Seeding Is

Seeding inserts initial data that the application needs to function before any user has touched it. It is distinct from migrations — migrations create the *structure* (tables, columns, indexes), seeding populates *data* into that structure.

For Manguito CMS, two system tables require seeding from schema files:

| Table | Source | Without it |
|-------|--------|-----------|
| `roles` | `roles.json` via `ParsedRoles` | User creation fails — `users.role_id` FK has nothing to reference |
| `base_paths` | `routes.json` via `ParsedRoutes` | Content creation fails — `content.base_path_id` FK has nothing to reference |

`media` and `users` are not seeded — they are populated at runtime.

---

## Design Principles

**Always runs on startup.** `seedSystemTables` is called every time `manguito dev` starts. Idempotency means "first run detection" is unnecessary — the seeder is safe to run against a fully populated DB.

**Diff-and-delete, not just upsert.** Pure upsert would leave stale rows when roles or base paths are removed from schema files. The seeder diffs the incoming data against existing DB rows and deletes anything that was removed — but only after checking for dependent data.

**Dependency checks before delete.** Deleting a role that has users assigned to it, or a base path that content items are using, would break FK constraints or leave orphaned data. The seeder checks for dependents and raises a clear, actionable error rather than letting the DB reject the operation with a cryptic FK violation.

**`dryRun` mode.** When `dryRun: true`, all checks run (including dependency checks) but no writes are executed. Returns the same `SeedResult` shape with what *would* have changed. Useful in CI to verify that a schema change won't break production.

---

## Function Signature

```ts
// packages/db/src/seeder/index.ts
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance, SeederOptions, SeedResult } from '../types'

export async function seedSystemTables(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
  options: SeederOptions = {}
): Promise<SeedResult>
```

Takes the Drizzle instance directly (not the `PostgresAdapter`) — the adapter calls `getDb()` internally before passing to the seeder.

---

## SeedResult

```ts
type SeedResult = {
  roles: {
    inserted: number
    updated: number
    deleted: number
  }
  base_paths: {
    inserted: number
    updated: number
    deleted: number
  }
}
```

Returned to the CLI for human-readable output:

```
✓ Roles:      0 inserted, 1 updated, 0 deleted
✓ Base paths: 1 inserted, 0 updated, 0 deleted
```

---

## Roles Seeding

```ts
async function seedRoles(
  db: DrizzlePostgresInstance,
  parsedRoles: ParsedRoles,
  dryRun: boolean
): Promise<SeedResult['roles']> {

  // 1. fetch current state
  const existing = await db
    .select({ name: roles.name })
    .from(roles)
  const existingNames = new Set(existing.map(r => r.name))
  const incomingNames = new Set(parsedRoles.roles.map(r => r.name))

  // 2. find removed roles
  const toDelete = [...existingNames].filter(n => !incomingNames.has(n))

  if (toDelete.length > 0) {
    // 3. check for users assigned to removed roles — join through role id
    const affected = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.role_id, roles.id))
      .where(inArray(roles.name, toDelete))

    if (affected.length > 0) {
      throw new Error(
        `SEEDER_ROLE_IN_USE: Cannot remove role(s) [${toDelete.join(', ')}] ` +
        `from roles.json — ${affected.length} user(s) are still assigned to them: ` +
        `${affected.map(u => u.email).join(', ')}. ` +
        `Reassign those users to another role before removing it from roles.json.`
      )
    }

    // 4. safe to delete
    if (!dryRun) {
      await db.delete(roles).where(inArray(roles.name, toDelete))
    }
  }

  // 5. upsert all incoming roles
  const inserted: string[] = []
  const updated: string[] = []

  for (const role of parsedRoles.roles) {
    const isNew = !existingNames.has(role.name)
    if (isNew) inserted.push(role.name)
    else updated.push(role.name)
  }

  if (!dryRun) {
    await db
      .insert(roles)
      .values(parsedRoles.roles.map(r => ({
        name: r.name,
        label: r.label,
        is_system: r.is_system,
        hierarchy_level: r.hierarchy_level,
        permissions: r.permissions,
      })))
      .onConflictDoUpdate({
        target: roles.name,
        set: {
          label: sql`excluded.label`,
          is_system: sql`excluded.is_system`,
          hierarchy_level: sql`excluded.hierarchy_level`,
          permissions: sql`excluded.permissions`,
          updated_at: sql`now()`,
        }
      })
  }

  return {
    inserted: inserted.length,
    updated: updated.length,
    deleted: toDelete.length,
  }
}
```

---

## Base Paths Seeding

```ts
async function seedBasePaths(
  db: DrizzlePostgresInstance,
  parsedRoutes: ParsedRoutes,
  dryRun: boolean
): Promise<SeedResult['base_paths']> {

  const existing = await db
    .select({ name: base_paths.name })
    .from(base_paths)
  const existingNames = new Set(existing.map(r => r.name))
  const incomingNames = new Set(parsedRoutes.base_paths.map(r => r.name))

  const toDelete = [...existingNames].filter(n => !incomingNames.has(n))

  if (toDelete.length > 0) {
    const inUse = await checkBasePathsInUse(db, toDelete)

    if (inUse.length > 0) {
      throw new Error(
        `SEEDER_BASE_PATH_IN_USE: Cannot remove base path(s) [${toDelete.join(', ')}] ` +
        `from routes.json — content items are still referencing them ` +
        `(${inUse.join(', ')}). ` +
        `Update or delete that content before removing the base path.`
      )
    }

    if (!dryRun) {
      await db.delete(base_paths).where(inArray(base_paths.name, toDelete))
    }
  }

  const inserted: string[] = []
  const updated: string[] = []

  for (const bp of parsedRoutes.base_paths) {
    if (!existingNames.has(bp.name)) inserted.push(bp.name)
    else updated.push(bp.name)
  }

  if (!dryRun) {
    await db
      .insert(base_paths)
      .values(parsedRoutes.base_paths)
      .onConflictDoUpdate({
        target: base_paths.name,
        set: {
          path: sql`excluded.path`,
          updated_at: sql`now()`,
        }
      })
  }

  return {
    inserted: inserted.length,
    updated: updated.length,
    deleted: toDelete.length,
  }
}
```

---

## Checking Base Paths In Use

At seeder runtime, the user-defined content tables exist in the DB but are not available as Drizzle schema objects (those are in the generated `schema.ts` which may not be loaded yet in dev). The check is done via `information_schema` — find all tables with a `base_path_id` column, then query each for matching base path IDs.

```ts
async function checkBasePathsInUse(
  db: DrizzlePostgresInstance,
  basePathNames: string[]
): Promise<string[]> {
  // find the IDs of the base paths being deleted
  const rows = await db
    .select({ id: base_paths.id, name: base_paths.name })
    .from(base_paths)
    .where(inArray(base_paths.name, basePathNames))

  if (rows.length === 0) return []

  const ids = rows.map(r => `'${r.id}'`).join(', ')

  // find all tables with a base_path_id column
  const tablesResult = await db.execute(
    sql`SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'base_path_id'`
  )

  const inUse: string[] = []

  for (const row of tablesResult.rows) {
    const tableName = (row as any).table_name as string
    const countResult = await db.execute(
      sql.raw(
        `SELECT COUNT(*) as count FROM "${tableName}"
         WHERE base_path_id IN (${ids})`
      )
    )
    const count = parseInt((countResult.rows[0] as any).count, 10)
    if (count > 0) inUse.push(tableName)
  }

  return inUse
}
```

This approach works before the generated Drizzle schema is loaded — it uses `information_schema` for discovery and raw SQL for the count queries.

---

## v1 Known Limitation

If a role or base path is removed from schema files but the seeder cannot delete it (because dependents exist), the developer must manually reassign users or update content before the removal takes effect. There is no automated migration path for this in v1.

This is intentional — silently reassigning users to a different role or updating content base paths without explicit developer action would be dangerous. The error message tells the developer exactly what needs to be done.

Document this in the user-facing docs when the CLI error messages are implemented in Phase 9.
