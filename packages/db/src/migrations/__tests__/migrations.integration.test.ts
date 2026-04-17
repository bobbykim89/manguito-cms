import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import type { SchemaRegistry, SystemField } from '@bobbykim/manguito-cms-core'
import { generateSchemaFile } from '../../codegen/index'
import { createPostgresAdapter } from '../../adapters/postgres'
import type { DrizzlePostgresInstance, MigrationRunnerOptions } from '../../types'
import {
  getMigrationStatus,
  generateMigration,
  applyMigrations,
} from '../index'

const DB_URL = process.env['DB_URL']

if (!DB_URL) {
  throw new Error('DB_URL must be set in .env.test before running integration tests')
}

// ─── Temp directory ───────────────────────────────────────────────────────────

const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-migrations')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')
const CONFIG_PATH = path.join(TMP_DIR, 'drizzle.config.ts')
const MIGRATIONS_FOLDER = path.join(TMP_DIR, 'migrations')
const MIGRATIONS_TABLE = '__manguito_migrations_test'

// ─── Minimal schema fixture ───────────────────────────────────────────────────

const SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const MINIMAL_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: {
    mig_test: {
      schema_type: 'content-type',
      name: 'mig_test',
      label: 'Migration Test',
      source_file: 'mig_test.json',
      only_one: false,
      default_base_path: 'test',
      system_fields: SYSTEM_FIELDS,
      fields: [],
      ui: { tabs: [] },
      db: { table_name: 'content_mig_test', junction_tables: [] },
      api: {
        default_base_path: 'test',
        http_methods: ['GET'],
        collection_path: '/test',
        item_path: '/test/:id',
      },
    },
  },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

let db: DrizzlePostgresInstance
const adapter = createPostgresAdapter({ url: DB_URL })

const migrationOptions: MigrationRunnerOptions = {
  migrationsTable: MIGRATIONS_TABLE,
  migrationsFolder: MIGRATIONS_FOLDER,
}

beforeAll(async () => {
  mkdirSync(TMP_DIR, { recursive: true })
  writeFileSync(SCHEMA_PATH, generateSchemaFile(MINIMAL_REGISTRY))
  // Use relative paths — drizzle-kit migrate prepends './' to absolute out paths,
  // producing './/absolute/path' which causes ENOENT on snapshot reads.
  writeFileSync(
    CONFIG_PATH,
    [
      "import { defineConfig } from 'drizzle-kit'",
      'export default defineConfig({',
      `  schema: './schema.ts',`,
      `  out: './migrations',`,
      "  dialect: 'postgresql',",
      "  dbCredentials: { url: process.env['DB_URL']! },",
      `  migrations: { table: '${MIGRATIONS_TABLE}', schema: 'public' },`,
      '})',
    ].join('\n'),
  )

  await adapter.connect()
  db = adapter.getDb()
})

afterAll(async () => {
  // Drop tables created by this suite
  await db
    .execute(sql.raw('DROP TABLE IF EXISTS content_mig_test CASCADE'))
    .catch(() => undefined)
  await db
    .execute(sql.raw(`DROP TABLE IF EXISTS "${MIGRATIONS_TABLE}" CASCADE`))
    .catch(() => undefined)

  await adapter.disconnect()
  rmSync(TMP_DIR, { recursive: true, force: true })
})

// ─── getMigrationStatus — fresh state ────────────────────────────────────────

describe('getMigrationStatus', () => {
  it('returns empty applied and pending lists when migrations table does not exist and folder is absent', async () => {
    const status = await getMigrationStatus(db, {
      migrationsTable: '__nonexistent_migrations_xyz__',
      migrationsFolder: path.join(TMP_DIR, '__nonexistent_folder__'),
    })

    expect(status.applied).toEqual([])
    expect(status.pending).toEqual([])
  })

  it('returns only pending when migration files exist but none are applied yet', async () => {
    // generateMigration writes .sql files into MIGRATIONS_FOLDER
    await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)

    const sqlFiles = readdirSync(MIGRATIONS_FOLDER).filter((f) =>
      f.endsWith('.sql'),
    )
    expect(sqlFiles.length).toBeGreaterThan(0)

    // Nothing applied yet → all files should be pending
    const status = await getMigrationStatus(db, migrationOptions)
    expect(status.applied).toEqual([])
    expect(status.pending.length).toBe(sqlFiles.length)
  }, 30_000)
})

// ─── applyMigrations — full cycle ─────────────────────────────────────────────

describe('applyMigrations', () => {
  it('runs without error and getMigrationStatus reflects applied migrations', async () => {
    // Drop all tables the migration will CREATE — drizzle-kit generates plain
    // CREATE TABLE (no IF NOT EXISTS), so pre-existing tables from the seeder
    // test's runDevMigration would cause "relation already exists" errors.
    for (const table of ['users', 'content_mig_test', 'content_test_article', 'roles', 'base_paths', 'media']) {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`))
    }
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${MIGRATIONS_TABLE}" CASCADE`))

    await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)

    const sqlFilesBefore = readdirSync(MIGRATIONS_FOLDER).filter((f) =>
      f.endsWith('.sql'),
    )
    expect(sqlFilesBefore.length).toBeGreaterThan(0)

    const result = await applyMigrations(CONFIG_PATH, db, migrationOptions)

    // applyMigrations returns applied count and zero skipped
    expect(result.skipped).toBe(0)

    // After apply, the content_mig_test table should exist
    const exists = await adapter.tableExists('content_mig_test')
    expect(exists).toBe(true)

    // getMigrationStatus should show no pending migrations
    const status = await getMigrationStatus(db, migrationOptions)
    expect(status.pending).toEqual([])
  }, 60_000)
})
