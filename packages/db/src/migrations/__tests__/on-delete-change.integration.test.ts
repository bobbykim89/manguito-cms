import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { describe, it, expect, afterAll } from 'vitest'
import { parseSchema, buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { ParsedSchema } from '@bobbykim/manguito-cms-core'
import { generateSchemaFile } from '../../codegen/index'
import { generateMigration } from '../index'

// drizzle-kit must emit a migration when only a reference's delete rule
// changes. Otherwise existing projects never receive the RESTRICT that
// required references now declare. `generate` diffs schema snapshots offline,
// so no database is touched.

const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-on-delete')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')
const CONFIG_PATH = path.join(TMP_DIR, 'drizzle.config.ts')
const MIGRATIONS_FOLDER = path.join(TMP_DIR, 'migrations')

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function registry(ownerRequired: boolean) {
  return buildSchemaRegistry(
    [
      parseOrThrow(
        { name: 'taxonomy--od_tag', label: 'Tag', type: 'taxonomy-type', fields: [{ name: 'name', label: 'Name', type: 'text/plain', required: false }] },
        'taxonomy-type',
        'tag.json'
      ),
      parseOrThrow(
        {
          name: 'content--od_post',
          label: 'Post',
          type: 'content-type',
          default_base_path: 'od-posts',
          only_one: false,
          fields: [{ tab: { name: 'main', label: 'Main', fields: [
            { name: 'owner', label: 'Owner', type: 'reference', target: 'taxonomy--od_tag', rel: 'one-to-one', required: ownerRequired },
          ] } }],
        },
        'content-type',
        'post.json'
      ),
    ],
    { base_paths: [] },
    { roles: [], valid_permissions: [] }
  )
}

afterAll(() => rmSync(TMP_DIR, { recursive: true, force: true }))

describe('drizzle-kit and a reference delete-rule change', () => {
  it('emits a migration that re-creates the FK with ON DELETE restrict', async () => {
    // MUTATION (in core): keep SET NULL for required references (revert Task 2's
    // fieldTypeRegistry change). The second migration then has no restrict
    // clause, and this test fails.
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
        "  dbCredentials: { url: 'postgresql://unused:unused@localhost:1/unused' },",
        '})',
      ].join('\n')
    )

    writeFileSync(SCHEMA_PATH, generateSchemaFile(registry(false)))
    const first = await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(first.length).toBeGreaterThan(0)

    writeFileSync(SCHEMA_PATH, generateSchemaFile(registry(true)))
    const second = await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(second.length).toBe(1)

    // generateMigration returns the new .sql file NAMES (packages/db/src/migrations/index.ts).
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, second[0]!), 'utf8')
    expect(text).toMatch(/ON DELETE restrict/i)
  })
})
