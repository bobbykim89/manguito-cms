import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '../../adapters/postgres'
import { linkUniqueName } from '../../link-tables'
import type { DrizzlePostgresInstance, MigrationRunnerOptions } from '../../types'
import { applyMigrations, generateMigration, previewMigration } from '../index'

const DB_URL = process.env['DB_URL']

if (!DB_URL) {
  throw new Error('DB_URL must be set in .env.test before running integration tests')
}

// An existing project upgrades: its link table holds duplicate (left, right)
// pairs, and the generated migration must remove them before adding the
// unique constraint.

const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-link-unique')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')
const CONFIG_PATH = path.join(TMP_DIR, 'drizzle.config.ts')
const MIGRATIONS_FOLDER = path.join(TMP_DIR, 'migrations')
const MIGRATIONS_TABLE = '__manguito_migrations_link_unique'
const LINK = 'junction_content_lu_post_tags'

// v1 models the codegen output from before link uniqueness: no constraint.
const V1 = [
  "import * as s from 'drizzle-orm/pg-core'",
  "export const contentLuPost = s.pgTable('content_lu_post', { id: s.uuid('id').primaryKey() })",
  "export const taxonomyLuTag = s.pgTable('taxonomy_lu_tag', { id: s.uuid('id').primaryKey() })",
  'export const junctionLuPostTags = s.pgTable(',
  `  '${LINK}',`,
  '  {',
  "    left_id: s.uuid('left_id').notNull().references(() => contentLuPost.id, { onDelete: 'cascade' }),",
  "    right_id: s.uuid('right_id').notNull().references(() => taxonomyLuTag.id, { onDelete: 'cascade' }),",
  "    order: s.integer('order').notNull().default(0),",
  '  },',
  '%CALLBACK%',
  ')',
  '',
].join('\n')

const V2_CALLBACK = [
  '  (table) => ({',
  `    pair: s.unique('${linkUniqueName(LINK)}').on(table.left_id, table.right_id),`,
  '  })',
].join('\n')

const P1 = '00000000-0000-0000-0000-0000000000a1'
const P2 = '00000000-0000-0000-0000-0000000000a2'
const P3 = '00000000-0000-0000-0000-0000000000a3'
const T = '00000000-0000-0000-0000-0000000000b1'

let db: DrizzlePostgresInstance
const adapter = createPostgresAdapter({ url: DB_URL })
const options: MigrationRunnerOptions = {
  migrationsTable: MIGRATIONS_TABLE,
  migrationsFolder: MIGRATIONS_FOLDER,
}

async function rows(): Promise<Array<{ left_id: string; order: number }>> {
  const r = await db.execute(
    sql.raw(`SELECT left_id, "order" FROM "${LINK}" ORDER BY left_id, "order"`),
  )
  return r.rows as Array<{ left_id: string; order: number }>
}

async function dropAll(): Promise<void> {
  for (const t of [LINK, 'content_lu_post', 'taxonomy_lu_tag', MIGRATIONS_TABLE]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`)).catch(() => undefined)
  }
}

beforeAll(async () => {
  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })
  writeFileSync(
    CONFIG_PATH,
    [
      "import { defineConfig } from 'drizzle-kit'",
      'export default defineConfig({',
      "  schema: './schema.ts',",
      "  out: './migrations',",
      "  dialect: 'postgresql',",
      "  dbCredentials: { url: process.env['DB_URL']! },",
      `  migrations: { table: '${MIGRATIONS_TABLE}', schema: 'public' },`,
      '})',
    ].join('\n'),
  )
  await adapter.connect()
  db = adapter.getDb()
  await dropAll()
})

afterAll(async () => {
  await dropAll()
  await adapter.disconnect()
  rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('upgrading a link table that holds duplicate pairs', () => {
  // MUTATION: removing the runGenerate rewrite leaves a bare ADD CONSTRAINT,
  // and applying it fails with "could not create unique index". Changing `>`
  // to `<` in linkDedupeSql keeps P1 at order 2, failing the first row check.
  it('removes the duplicates, adds the constraint, and re-applies safely', async () => {
    writeFileSync(SCHEMA_PATH, V1.replace('%CALLBACK%', ''))
    expect((await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)).length).toBe(1)
    await applyMigrations(CONFIG_PATH, db, options)

    await db.execute(sql.raw(`INSERT INTO content_lu_post (id) VALUES ('${P1}'), ('${P2}'), ('${P3}')`))
    await db.execute(sql.raw(`INSERT INTO taxonomy_lu_tag (id) VALUES ('${T}')`))
    await db.execute(
      sql.raw(
        `INSERT INTO "${LINK}" (left_id, right_id, "order") VALUES ` +
          `('${P1}', '${T}', 2), ('${P1}', '${T}', 0), ` +
          `('${P2}', '${T}', 1), ('${P2}', '${T}', 1), ` +
          `('${P3}', '${T}', 0)`,
      ),
    )

    writeFileSync(SCHEMA_PATH, V1.replace('%CALLBACK%', V2_CALLBACK))

    // Dry run first: the preview must show the rewritten migration.
    const preview = await previewMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(preview).toHaveLength(1)
    expect(preview[0]!.sql).toContain('DO $$')

    const generated = await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(generated).toHaveLength(1)
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, generated[0]!), 'utf8')
    expect(text).toContain('DO $$')
    expect(text).toContain('pg_constraint')

    await applyMigrations(CONFIG_PATH, db, options)
    expect(await rows()).toEqual([
      { left_id: P1, order: 0 },
      { left_id: P2, order: 1 },
      { left_id: P3, order: 0 },
    ])

    await expect(
      db.execute(sql.raw(`INSERT INTO "${LINK}" (left_id, right_id, "order") VALUES ('${P3}', '${T}', 5)`)),
    ).rejects.toMatchObject({ cause: { code: '23505' } })

    // Re-apply: the guard makes the block a no-op once the constraint exists.
    // MUTATION: dropping the NOT EXISTS guard makes the ADD CONSTRAINT fail
    // here with "already exists".
    for (const statement of text.split('--> statement-breakpoint')) {
      await db.execute(sql.raw(statement))
    }
    expect(await rows()).toHaveLength(3)
  })
})
