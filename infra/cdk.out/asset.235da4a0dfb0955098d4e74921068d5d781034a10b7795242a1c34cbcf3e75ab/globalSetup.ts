import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import {
  createPostgresAdapter,
  generateSchemaFile,
  seedSystemTables,
  generateMigration,
  applyMigrations,
} from '@bobbykim/manguito-cms-db'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { testParsedSchema, testRoleUsers } from '@bobbykim/manguito-cms-test-utils'

// ─── Temp workspace for drizzle config + generated schema ────────────────────
//
// Kept persistent across runs so drizzle-kit's migration journal is stable.
// The tracking table (MIGRATIONS_TABLE) correlates the journal's `when` field
// with applied rows — if the directory were deleted each run, previously-applied
// migrations would appear pending on a non-fresh DB.

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.join(ROOT, '.tmp-globalsetup')
const SCHEMA_PATH = path.join(TMP, 'schema.ts')
const CONFIG_PATH = path.join(TMP, 'drizzle.config.ts')
const MIGRATIONS_FOLDER = path.join(TMP, 'migrations')
const MIGRATIONS_TABLE = '__manguito_migrations'

let pgAdapter: ReturnType<typeof createPostgresAdapter> | null = null

export async function setup(): Promise<void> {
  const dbUrl = process.env['DB_URL']

  // ── Step 1 — Preflight DB connection check ───────────────────────────────────

  if (!dbUrl) {
    console.error(
      `✖ Integration tests require a running Postgres instance.\n` +
        `\n  Could not connect to: (DB_URL not set in .env.test)\n` +
        `\n  Start the test database with:\n    docker compose up -d\n` +
        `\n  Then re-run tests:\n    pnpm test`,
    )
    process.exit(1)
  }

  pgAdapter = createPostgresAdapter({ url: dbUrl })

  try {
    await pgAdapter.connect()
  } catch {
    console.error(
      `✖ Integration tests require a running Postgres instance.\n` +
        `\n  Could not connect to: ${dbUrl}\n` +
        `\n  Start the test database with:\n    docker compose up -d\n` +
        `\n  Then re-run tests:\n    pnpm test`,
    )
    process.exit(1)
  }

  const db = pgAdapter.getDb()

  // ── Step 2 — Run migrations ──────────────────────────────────────────────────

  mkdirSync(TMP, { recursive: true })

  writeFileSync(SCHEMA_PATH, generateSchemaFile(testParsedSchema))

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

  await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
  await applyMigrations(CONFIG_PATH, db, {
    migrationsTable: MIGRATIONS_TABLE,
    migrationsFolder: MIGRATIONS_FOLDER,
  })

  // ── Step 3 — Seed system tables ──────────────────────────────────────────────

  await seedSystemTables(db, testParsedSchema)

  // ── Step 4 — Insert role user fixtures ───────────────────────────────────────

  for (const user of testRoleUsers) {
    const hash = await hashPassword(user.password)
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
          SELECT ${user.id}, ${user.email}, ${hash}, r.id, ${user.token_version}, ${user.must_change_password}
          FROM roles r WHERE r.name = ${user.role}
          ON CONFLICT (email) DO NOTHING`,
    )
  }
}

export async function teardown(): Promise<void> {
  if (pgAdapter) {
    await pgAdapter.disconnect()
    pgAdapter = null
  }
}
