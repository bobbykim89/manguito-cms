import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import type {
  ParsedRoles,
  ParsedRoutes,
  SchemaRegistry,
  SystemField,
} from '@bobbykim/manguito-cms-core'
import { generateSchemaFile } from '../../codegen/index'
import { runDevMigration } from '../../migrations/index'
import { createPostgresAdapter } from '../../adapters/postgres'
import type { DrizzlePostgresInstance } from '../../types'
import { seedSystemTables } from '../index'

const DB_URL = process.env['DB_URL']

if (!DB_URL) {
  throw new Error('DB_URL must be set in .env.test before running integration tests')
}

// ─── Temp directory for drizzle config + schema ───────────────────────────────

const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-seeder')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')
const CONFIG_PATH = path.join(TMP_DIR, 'drizzle.config.ts')

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CONTENT_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
  { name: 'slug', db_type: 'varchar', nullable: false },
  { name: 'base_path_id', db_type: 'uuid', nullable: false },
  { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const ROLES_TWO: ParsedRoles = {
  roles: [
    {
      name: 'admin',
      label: 'Administrator',
      is_system: true,
      hierarchy_level: 1,
      permissions: ['*'],
    },
    {
      name: 'editor',
      label: 'Editor',
      hierarchy_level: 2,
      permissions: ['content:read', 'content:write'],
    },
  ],
  valid_permissions: ['*', 'content:read', 'content:write'],
}

const ROLES_ONE: ParsedRoles = {
  roles: [
    {
      name: 'admin',
      label: 'Administrator',
      is_system: true,
      hierarchy_level: 1,
      permissions: ['*'],
    },
  ],
  valid_permissions: ['*'],
}

const ROUTES_TWO: ParsedRoutes = {
  base_paths: [
    { name: 'blog', path: '/blog' },
    { name: 'pages', path: '/pages' },
  ],
}

const ROUTES_ONE: ParsedRoutes = {
  base_paths: [{ name: 'blog', path: '/blog' }],
}

function makeRegistry(roles: ParsedRoles, routes: ParsedRoutes): SchemaRegistry {
  return {
    routes,
    roles,
    schemas: {},
    content_types: {
      test_article: {
        schema_type: 'content-type',
        name: 'test_article',
        label: 'Test Article',
        source_file: 'test_article.json',
        only_one: false,
        default_base_path: 'blog',
        system_fields: CONTENT_SYSTEM_FIELDS,
        fields: [],
        ui: { tabs: [] },
        db: { table_name: 'content_test_article', junction_tables: [] },
        api: {
          default_base_path: 'blog',
          http_methods: ['GET'],
          collection_path: '/blog',
          item_path: '/blog/:slug',
        },
      },
    },
    paragraph_types: {},
    taxonomy_types: {},
    enum_types: {},
    all_schemas: [],
  }
}

const BASE_REGISTRY = makeRegistry(ROLES_TWO, ROUTES_TWO)

// ─── Suite setup ──────────────────────────────────────────────────────────────

let db: DrizzlePostgresInstance
const adapter = createPostgresAdapter({ url: DB_URL })

beforeAll(async () => {
  // Write drizzle config and generated schema to temp directory
  mkdirSync(TMP_DIR, { recursive: true })
  writeFileSync(SCHEMA_PATH, generateSchemaFile(BASE_REGISTRY))
  writeFileSync(
    CONFIG_PATH,
    [
      "import { defineConfig } from 'drizzle-kit'",
      'export default defineConfig({',
      `  schema: './schema.ts',`,
      "  dialect: 'postgresql',",
      "  dbCredentials: { url: process.env['DB_URL']! },",
      '})',
    ].join('\n'),
  )

  // Push schema to test DB (creates all tables)
  await runDevMigration(CONFIG_PATH)

  await adapter.connect()
  db = adapter.getDb()
}, 60_000)

afterAll(async () => {
  await adapter.disconnect()
  rmSync(TMP_DIR, { recursive: true, force: true })
})

beforeEach(async () => {
  // Truncate in FK-safe order: users first (FK to roles), then content, then roles/base_paths
  await db.execute(
    sql.raw(
      'TRUNCATE TABLE users, content_test_article, base_paths, roles RESTART IDENTITY CASCADE',
    ),
  )
})

// ─── Full sync cycle ──────────────────────────────────────────────────────────

describe('seedSystemTables — full sync cycle', () => {
  it('inserts initial roles and base paths, returns correct inserted counts', async () => {
    const result = await seedSystemTables(db, BASE_REGISTRY)

    expect(result.roles.inserted).toBe(2)
    expect(result.roles.updated).toBe(0)
    expect(result.roles.deleted).toBe(0)

    expect(result.base_paths.inserted).toBe(2)
    expect(result.base_paths.updated).toBe(0)
    expect(result.base_paths.deleted).toBe(0)
  })

  it('update cycle: re-seeding with changed label returns updated counts', async () => {
    await seedSystemTables(db, BASE_REGISTRY)

    const updatedRoles: ParsedRoles = {
      ...ROLES_TWO,
      roles: [
        { ...ROLES_TWO.roles[0]!, label: 'Super Admin' },
        ROLES_TWO.roles[1]!,
      ],
    }
    const result = await seedSystemTables(db, makeRegistry(updatedRoles, ROUTES_TWO))

    expect(result.roles.inserted).toBe(0)
    expect(result.roles.updated).toBe(2)
    expect(result.roles.deleted).toBe(0)

    // Verify label was actually updated in DB
    const rows = await db.execute(
      sql.raw("SELECT label FROM roles WHERE name = 'admin'"),
    )
    expect((rows.rows[0] as { label: string }).label).toBe('Super Admin')
  })
})

// ─── Safe delete ──────────────────────────────────────────────────────────────

describe('seedSystemTables — safe delete', () => {
  it('removes a role with no assigned users and returns deleted count', async () => {
    await seedSystemTables(db, BASE_REGISTRY)

    const result = await seedSystemTables(db, makeRegistry(ROLES_ONE, ROUTES_TWO))

    expect(result.roles.deleted).toBe(1)
    expect(result.roles.updated).toBe(1)
    expect(result.roles.inserted).toBe(0)

    // Verify editor role is gone
    const rows = await db.execute(
      sql.raw("SELECT COUNT(*) AS count FROM roles WHERE name = 'editor'"),
    )
    expect(parseInt((rows.rows[0] as { count: string }).count, 10)).toBe(0)
  })

  it('removes a base path with no content referencing it and returns deleted count', async () => {
    await seedSystemTables(db, BASE_REGISTRY)

    const result = await seedSystemTables(db, makeRegistry(ROLES_TWO, ROUTES_ONE))

    expect(result.base_paths.deleted).toBe(1)
    expect(result.base_paths.updated).toBe(1)
    expect(result.base_paths.inserted).toBe(0)
  })
})

// ─── Blocked deletes ─────────────────────────────────────────────────────────

describe('seedSystemTables — delete blocked', () => {
  it('throws SEEDER_ROLE_IN_USE with user email when a user is assigned to the role being removed', async () => {
    await seedSystemTables(db, BASE_REGISTRY)

    // Insert a user assigned to the editor role
    const roleRows = await db.execute(
      sql.raw("SELECT id FROM roles WHERE name = 'editor'"),
    )
    const roleId = (roleRows.rows[0] as { id: string }).id
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, created_at, updated_at)
          VALUES (gen_random_uuid(), 'blocked@example.com', 'hash', ${roleId}::uuid, 0, now(), now())`,
    )

    let caughtError: Error | null = null
    try {
      await seedSystemTables(db, makeRegistry(ROLES_ONE, ROUTES_TWO))
    } catch (e) {
      caughtError = e as Error
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError!.message).toContain('SEEDER_ROLE_IN_USE')
    expect(caughtError!.message).toContain('blocked@example.com')
    expect(caughtError!.message).toContain('editor')
  })

  it('throws SEEDER_BASE_PATH_IN_USE with table name when content references the base path being removed', async () => {
    await seedSystemTables(db, BASE_REGISTRY)

    // Insert a content row referencing the 'pages' base path
    const bpRows = await db.execute(
      sql.raw("SELECT id FROM base_paths WHERE name = 'pages'"),
    )
    const bpId = (bpRows.rows[0] as { id: string }).id
    await db.execute(
      sql`INSERT INTO content_test_article (id, slug, base_path_id, published, created_at, updated_at)
          VALUES (gen_random_uuid(), 'test-slug', ${bpId}::uuid, false, now(), now())`,
    )

    let caughtError: Error | null = null
    try {
      await seedSystemTables(db, makeRegistry(ROLES_TWO, ROUTES_ONE))
    } catch (e) {
      caughtError = e as Error
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError!.message).toContain('SEEDER_BASE_PATH_IN_USE')
    expect(caughtError!.message).toContain('content_test_article')
    expect(caughtError!.message).toContain('pages')
  })
})

// ─── dryRun mode ─────────────────────────────────────────────────────────────

describe('seedSystemTables — dryRun', () => {
  it('returns correct counts but writes nothing to the DB', async () => {
    const result = await seedSystemTables(db, BASE_REGISTRY, { dryRun: true })

    // Counts reflect what would have been written
    expect(result.roles.inserted).toBe(2)
    expect(result.base_paths.inserted).toBe(2)

    // Nothing was actually written
    const roleCount = await db.execute(sql.raw('SELECT COUNT(*) AS count FROM roles'))
    expect(
      parseInt((roleCount.rows[0] as { count: string }).count, 10),
    ).toBe(0)

    const bpCount = await db.execute(
      sql.raw('SELECT COUNT(*) AS count FROM base_paths'),
    )
    expect(
      parseInt((bpCount.rows[0] as { count: string }).count, 10),
    ).toBe(0)
  })

  it('dryRun with a blocked delete: still throws the error before any writes', async () => {
    // Seed real data first
    await seedSystemTables(db, BASE_REGISTRY)

    // Insert a user assigned to editor
    const roleRows = await db.execute(
      sql.raw("SELECT id FROM roles WHERE name = 'editor'"),
    )
    const roleId = (roleRows.rows[0] as { id: string }).id
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, created_at, updated_at)
          VALUES (gen_random_uuid(), 'dry@example.com', 'hash', ${roleId}::uuid, 0, now(), now())`,
    )

    // dryRun should still throw the dependency error
    await expect(
      seedSystemTables(db, makeRegistry(ROLES_ONE, ROUTES_TWO), { dryRun: true }),
    ).rejects.toThrow('SEEDER_ROLE_IN_USE')
  })
})
