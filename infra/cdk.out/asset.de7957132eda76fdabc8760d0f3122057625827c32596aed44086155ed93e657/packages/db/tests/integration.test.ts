import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '../src/adapters/postgres'
import { seedSystemTables } from '../src/seeder/index'
import { getMigrationStatus, applyMigrations } from '../src/migrations/index'
import type { DrizzlePostgresInstance, MigrationRunnerOptions } from '../src/types'
import {
  getTestDb,
  teardownTestData,
  testParsedSchema,
} from '@bobbykim/manguito-cms-test-utils'

// ─── globalSetup reference paths ──────────────────────────────────────────────
//
// These mirror the constants in globalSetup.ts so that getMigrationStatus and
// applyMigrations point at the same journal file and tracking table that
// globalSetup used when it ran migrations.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const GLOBAL_TMP = path.join(REPO_ROOT, '.tmp-globalsetup')
const MIGRATIONS_FOLDER = path.join(GLOBAL_TMP, 'migrations')
const MIGRATIONS_TABLE = '__manguito_migrations'
const CONFIG_PATH = path.join(GLOBAL_TMP, 'drizzle.config.ts')

const MIGRATION_OPTIONS: MigrationRunnerOptions = {
  migrationsTable: MIGRATIONS_TABLE,
  migrationsFolder: MIGRATIONS_FOLDER,
}

// ─── Shared DB connection ─────────────────────────────────────────────────────

let db: DrizzlePostgresInstance

beforeAll(async () => {
  db = await getTestDb()
})

// ─── Fixture builders ─────────────────────────────────────────────────────────

// Returns testParsedSchema with one extra role appended.
// Spreads the viewer role as a type-safe template to avoid importing Permission.
function withExtraRole(roleName: string, hierarchyLevel: number) {
  const viewer = testParsedSchema.roles.roles.find((r) => r.name === 'viewer')!
  return {
    ...testParsedSchema,
    roles: {
      ...testParsedSchema.roles,
      roles: [
        ...testParsedSchema.roles.roles,
        { ...viewer, name: roleName, label: `Test ${roleName}`, is_system: false, hierarchy_level: hierarchyLevel },
      ],
    },
  }
}

// Returns testParsedSchema with one extra base path appended.
function withExtraBasePath(name: string, bpPath: string) {
  return {
    ...testParsedSchema,
    routes: {
      base_paths: [...testParsedSchema.routes.base_paths, { name, path: bpPath }],
    },
  }
}

// ─── PostgresAdapter ──────────────────────────────────────────────────────────

describe('PostgresAdapter', () => {
  const DB_URL = process.env['DB_URL']!

  // Shared adapter for read-only introspection tests
  let adapter: ReturnType<typeof createPostgresAdapter>

  beforeAll(async () => {
    adapter = createPostgresAdapter({ url: DB_URL })
    await adapter.connect()
  })

  afterAll(async () => {
    await adapter.disconnect()
  })

  it('connect() succeeds with a valid DB_URL', () => {
    // connect() was called in beforeAll without throwing — verify via isConnected
    expect(adapter.isConnected()).toBe(true)
  })

  it('isConnected() returns false before connect, true after connect, false after disconnect', async () => {
    const a = createPostgresAdapter({ url: DB_URL })
    expect(a.isConnected()).toBe(false)
    await a.connect()
    expect(a.isConnected()).toBe(true)
    await a.disconnect()
    expect(a.isConnected()).toBe(false)
  })

  it('getDb() throws before connect() is called', () => {
    const a = createPostgresAdapter({ url: DB_URL })
    expect(() => a.getDb()).toThrow()
  })

  it('tableExists() returns false for a non-existent table', async () => {
    expect(await adapter.tableExists('__no_such_table_xyzzy__')).toBe(false)
  })

  it('tableExists() returns true for the users table', async () => {
    expect(await adapter.tableExists('users')).toBe(true)
  })

  it('getTableNames() includes all system tables', async () => {
    const names = await adapter.getTableNames()
    expect(names).toContain('users')
    expect(names).toContain('roles')
    expect(names).toContain('media')
  })

  it('createPostgresAdapter() with no URL throws DB_URL_MISSING', () => {
    const saved = process.env['DB_URL']
    delete process.env['DB_URL']
    try {
      expect(() => createPostgresAdapter()).toThrow('DB_URL_MISSING')
    } finally {
      process.env['DB_URL'] = saved
    }
  })

  it('createPostgresAdapter() with an invalid URL format throws DB_URL_INVALID', () => {
    expect(() => createPostgresAdapter({ url: 'mysql://localhost/test' })).toThrow('DB_URL_INVALID')
  })
})

// ─── Seeder ───────────────────────────────────────────────────────────────────

describe('Seeder', () => {
  beforeAll(async () => {
    // Restore the canonical seed state before this suite runs. Defensive against
    // other test files that may have modified roles or base_paths beforehand.
    await seedSystemTables(db, testParsedSchema)
  })

  // ─── Roles ─────────────────────────────────────────────────────────────────

  it('inserting a new role returns inserted count > 0', async () => {
    const result = await seedSystemTables(db, withExtraRole('test_insert_role', 99))

    expect(result.roles.inserted).toBeGreaterThan(0)

    // Cleanup
    const row = await db.execute(sql`SELECT id FROM roles WHERE name = 'test_insert_role'`)
    if (row.rows[0]) {
      await teardownTestData(db, 'roles', (row.rows[0] as { id: string }).id)
    }
  })

  it('updating an existing role label returns updated count > 0 and inserted count 0', async () => {
    const modifiedRoles = {
      ...testParsedSchema.roles,
      roles: testParsedSchema.roles.roles.map((r) =>
        r.name === 'admin' ? { ...r, label: 'Administrator (modified)' } : r,
      ),
    }

    const result = await seedSystemTables(db, { ...testParsedSchema, roles: modifiedRoles })

    expect(result.roles.updated).toBeGreaterThan(0)
    expect(result.roles.inserted).toBe(0)

    // Cleanup: restore original labels
    await seedSystemTables(db, testParsedSchema)
  })

  it('removing a role with no assigned users returns deleted count > 0', async () => {
    // Seed a temp role into the DB
    await seedSystemTables(db, withExtraRole('test_delete_role', 98))

    // Sync back to testParsedSchema — the temp role is absent, so it gets deleted
    const result = await seedSystemTables(db, testParsedSchema)

    expect(result.roles.deleted).toBeGreaterThan(0)
    // No additional cleanup — the deletion was the cleanup
  })

  it('removing a role assigned to a user throws SEEDER_ROLE_IN_USE with user email', async () => {
    // Seed a temp role
    await seedSystemTables(db, withExtraRole('test_blocked_role', 97))

    const roleRow = await db.execute(
      sql`SELECT id FROM roles WHERE name = 'test_blocked_role'`,
    )
    const roleId = (roleRow.rows[0] as { id: string }).id

    // Assign a user to that role
    const tempUserId = '77770000-0000-0000-0000-000000000001'
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id)
          VALUES (${tempUserId}, 'seeder-blocked@test.local', 'testhash', ${roleId}::uuid)`,
    )

    let caught: Error | undefined
    try {
      await seedSystemTables(db, testParsedSchema)
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toContain('SEEDER_ROLE_IN_USE')
    expect(caught!.message).toContain('seeder-blocked@test.local')

    // Cleanup: user first (FK to roles), then role
    await teardownTestData(db, 'users', tempUserId)
    await teardownTestData(db, 'roles', roleId)
  })

  // ─── dryRun ────────────────────────────────────────────────────────────────

  it('dryRun: returns non-zero counts but writes no rows to the DB', async () => {
    const before = await db.execute(sql`SELECT COUNT(*) AS count FROM roles`)
    const countBefore = parseInt((before.rows[0] as { count: string }).count, 10)

    // Registry has one extra role — without dryRun it would be inserted
    const result = await seedSystemTables(db, withExtraRole('test_dryrun_role', 96), {
      dryRun: true,
    })

    expect(result.roles.inserted).toBeGreaterThan(0)

    const after = await db.execute(sql`SELECT COUNT(*) AS count FROM roles`)
    const countAfter = parseInt((after.rows[0] as { count: string }).count, 10)

    expect(countAfter).toBe(countBefore) // nothing written
  })

  // ─── Base paths ────────────────────────────────────────────────────────────

  it('removing a base path with no content rows returns deleted count > 0', async () => {
    // Seed a temp base path into the DB
    await seedSystemTables(db, withExtraBasePath('test-extra-path', '/test-extra'))

    // Sync back to testParsedSchema — the temp path is absent, so it gets deleted
    const result = await seedSystemTables(db, testParsedSchema)

    expect(result.base_paths.deleted).toBeGreaterThan(0)
  })

  it('removing a base path that has content rows throws SEEDER_BASE_PATH_IN_USE', async () => {
    // Seed a temp base path
    await seedSystemTables(db, withExtraBasePath('test-blocked-path', '/test-blocked'))

    const bpRow = await db.execute(
      sql`SELECT id FROM base_paths WHERE name = 'test-blocked-path'`,
    )
    const bpId = (bpRow.rows[0] as { id: string }).id

    // Insert a content row that references this base path
    const contentId = '66660000-0000-0000-0000-000000000001'
    await db.execute(
      sql`INSERT INTO content_article (id, slug, base_path_id, title, body)
          VALUES (${contentId}, 'seeder-blocked-slug', ${bpId}::uuid, 'Blocked', 'Blocked body')`,
    )

    let caught: Error | undefined
    try {
      await seedSystemTables(db, testParsedSchema)
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toContain('SEEDER_BASE_PATH_IN_USE')
    expect(caught!.message).toContain('content_article')

    // Cleanup: content row first, then base path
    await teardownTestData(db, 'content_article', contentId)
    await teardownTestData(db, 'base_paths', bpId)
  })
})

// ─── Migrations ───────────────────────────────────────────────────────────────

describe('Migrations', () => {
  it('getMigrationStatus returns a non-empty applied array and empty pending array after globalSetup', async () => {
    const status = await getMigrationStatus(db, MIGRATION_OPTIONS)

    expect(Array.isArray(status.applied)).toBe(true)
    expect(status.applied.length).toBeGreaterThan(0)
    expect(status.pending).toHaveLength(0)
  })

  it('applyMigrations is idempotent: re-running already-applied migrations does not throw', async () => {
    // globalSetup already applied all migrations — re-running must not error
    const result = await applyMigrations(CONFIG_PATH, db, MIGRATION_OPTIONS)

    expect(result.skipped).toBe(0)
  }, 30_000)
})
