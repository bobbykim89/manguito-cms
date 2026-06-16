import { eq, inArray, sql } from 'drizzle-orm'
import * as s from 'drizzle-orm/pg-core'
import type {
  ParsedRoles,
  ParsedRoutes,
  SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance, SeederOptions, SeedResult } from '../types'

// ─── System Table Schema Objects ──────────────────────────────────────────────

const base_paths = s.pgTable('base_paths', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  name: s.varchar('name', { length: 255 }).notNull().unique(),
  path: s.varchar('path', { length: 1024 }).notNull().unique(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

const roles = s.pgTable('roles', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  name: s.varchar('name', { length: 255 }).notNull().unique(),
  label: s.varchar('label', { length: 255 }).notNull(),
  is_system: s.boolean('is_system').notNull().default(false),
  hierarchy_level: s.integer('hierarchy_level').notNull().unique(),
  permissions: s.text('permissions').array().notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

const users = s.pgTable('users', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  email: s.varchar('email', { length: 255 }).notNull().unique(),
  password_hash: s.varchar('password_hash', { length: 255 }).notNull(),
  role_id: s.uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  token_version: s.integer('token_version').notNull().default(0),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

// ─── checkBasePathsInUse ──────────────────────────────────────────────────────

async function checkBasePathsInUse(
  db: DrizzlePostgresInstance,
  basePathNames: string[],
): Promise<string[]> {
  const rows = await db
    .select({ id: base_paths.id, name: base_paths.name })
    .from(base_paths)
    .where(inArray(base_paths.name, basePathNames))

  if (rows.length === 0) return []

  const ids = rows.map((r) => `'${r.id}'`).join(', ')

  const tablesResult = await db.execute(
    sql`SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'base_path_id'`,
  )

  const inUse: string[] = []

  for (const row of tablesResult.rows) {
    const tableName = (row as { table_name: string }).table_name
    const countResult = await db.execute(
      sql.raw(
        `SELECT COUNT(*) as count FROM "${tableName}"
         WHERE base_path_id IN (${ids})`,
      ),
    )
    const count = parseInt(
      ((countResult.rows[0] as { count: string }).count),
      10,
    )
    if (count > 0) inUse.push(tableName)
  }

  return inUse
}

// ─── seedRoles ────────────────────────────────────────────────────────────────

async function seedRoles(
  db: DrizzlePostgresInstance,
  parsedRoles: ParsedRoles,
  dryRun: boolean,
): Promise<SeedResult['roles']> {
  const existing = await db.select({ name: roles.name }).from(roles)
  const existingNames = new Set(existing.map((r) => r.name))
  const incomingNames = new Set(parsedRoles.roles.map((r) => r.name))

  const toDelete = [...existingNames].filter((n) => !incomingNames.has(n))

  if (toDelete.length > 0) {
    const affected = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.role_id, roles.id))
      .where(inArray(roles.name, toDelete))

    if (affected.length > 0) {
      throw new Error(
        `SEEDER_ROLE_IN_USE: Cannot remove role(s) [${toDelete.join(', ')}] ` +
          `from roles.json — ${affected.length} user(s) are still assigned to them: ` +
          `${affected.map((u) => u.email).join(', ')}. ` +
          `Reassign those users to another role before removing it from roles.json.`,
      )
    }

    if (!dryRun) {
      await db.delete(roles).where(inArray(roles.name, toDelete))
    }
  }

  const inserted: string[] = []
  const updated: string[] = []

  for (const role of parsedRoles.roles) {
    if (!existingNames.has(role.name)) inserted.push(role.name)
    else updated.push(role.name)
  }

  if (!dryRun) {
    await db
      .insert(roles)
      .values(
        parsedRoles.roles.map((r) => ({
          name: r.name,
          label: r.label,
          is_system: r.is_system ?? false,
          hierarchy_level: r.hierarchy_level,
          permissions: r.permissions,
        })),
      )
      .onConflictDoUpdate({
        target: roles.name,
        set: {
          label: sql`excluded.label`,
          is_system: sql`excluded.is_system`,
          hierarchy_level: sql`excluded.hierarchy_level`,
          permissions: sql`excluded.permissions`,
          updated_at: sql`now()`,
        },
      })
  }

  return {
    inserted: inserted.length,
    updated: updated.length,
    deleted: toDelete.length,
  }
}

// ─── seedBasePaths ────────────────────────────────────────────────────────────

async function seedBasePaths(
  db: DrizzlePostgresInstance,
  parsedRoutes: ParsedRoutes,
  dryRun: boolean,
): Promise<SeedResult['base_paths']> {
  const existing = await db.select({ name: base_paths.name }).from(base_paths)
  const existingNames = new Set(existing.map((r) => r.name))
  const incomingNames = new Set(parsedRoutes.base_paths.map((r) => r.name))

  const toDelete = [...existingNames].filter((n) => !incomingNames.has(n))

  if (toDelete.length > 0) {
    const inUse = await checkBasePathsInUse(db, toDelete)

    if (inUse.length > 0) {
      throw new Error(
        `SEEDER_BASE_PATH_IN_USE: Cannot remove base path(s) [${toDelete.join(', ')}] ` +
          `from routes.json — content items are still referencing them ` +
          `(${inUse.join(', ')}). ` +
          `Update or delete that content before removing the base path.`,
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
        },
      })
  }

  return {
    inserted: inserted.length,
    updated: updated.length,
    deleted: toDelete.length,
  }
}

// ─── seedSystemTables ─────────────────────────────────────────────────────────

export async function seedSystemTables(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
  options: SeederOptions = {},
): Promise<SeedResult> {
  const dryRun = options.dryRun ?? false

  const rolesResult = await seedRoles(db, registry.roles, dryRun)
  const basePathsResult = await seedBasePaths(db, registry.routes, dryRun)

  return {
    roles: rolesResult,
    base_paths: basePathsResult,
  }
}
