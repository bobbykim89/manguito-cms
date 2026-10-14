import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fsPromises from 'node:fs/promises'
import type { ParsedField, SchemaRegistry, SystemField } from '@bobbykim/manguito-cms-core'
import { generateSchemaFile } from '../../codegen/index'
import { generateMigration, previewMigration } from '../index'

// previewMigration runs the real drizzle-kit generate, so `manguito migrate
// --dry-run` can show the SQL. Before #72 the dry run left the generated files
// in migrations/ while saying nothing was written.

const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-preview')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')
const CONFIG_PATH = path.join(TMP_DIR, 'drizzle.config.ts')
const MIGRATIONS_FOLDER = path.join(TMP_DIR, 'migrations')

const SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const NOTE: ParsedField = {
  name: 'note', label: 'Note', field_type: 'text/plain', required: false, nullable: true, order: 0,
  validation: { required: false },
  db_column: { column_name: 'note', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

function registryWith(fields: ParsedField[]): SchemaRegistry {
  return {
    routes: { base_paths: [] },
    roles: { roles: [], valid_permissions: [] },
    schemas: {},
    content_types: {
      prev_test: {
        schema_type: 'content-type', name: 'prev_test', label: 'Preview Test', source_file: 'prev_test.json',
        only_one: false, default_base_path: 'test', system_fields: SYSTEM_FIELDS, fields, ui: { tabs: [] },
        db: { table_name: 'content_prev_test', junction_tables: [] },
        api: { default_base_path: 'test', http_methods: ['GET'], collection_path: '/test', item_path: '/test/:id' },
      },
    },
    paragraph_types: {}, taxonomy_types: {}, enum_types: {}, all_schemas: [],
  }
}

function writeConfig(): void {
  writeFileSync(
    CONFIG_PATH,
    [
      "import { defineConfig } from 'drizzle-kit'",
      'export default defineConfig({',
      `  schema: './schema.ts',`,
      `  out: './migrations',`,
      "  dialect: 'postgresql',",
      "  dbCredentials: { url: process.env['DB_URL']! },",
      '})',
    ].join('\n'),
  )
}

// Every file in the migrations folder with its contents, to compare states.
function folderState(): Record<string, string> {
  if (!existsSync(MIGRATIONS_FOLDER)) return {}
  const state: Record<string, string> = {}
  for (const rel of readdirSync(MIGRATIONS_FOLDER, { recursive: true }) as string[]) {
    const full = path.join(MIGRATIONS_FOLDER, rel)
    try {
      state[rel] = readFileSync(full, 'utf8')
    } catch {
      state[`${rel}/`] = '' // a directory
    }
  }
  return state
}

beforeEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })
  writeFileSync(SCHEMA_PATH, generateSchemaFile(registryWith([])))
  writeConfig()
})

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('previewMigration', () => {
  it('returns the first migration and leaves no migrations folder behind', async () => {
    // MUTATION: return generateMigration's files without restoring the folder
    // (the dry run before #72). migrations/ then holds the .sql, the snapshot
    // and the journal, and the next real run generates nothing.
    const preview = await previewMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(preview).toHaveLength(1)
    expect(preview[0]!.sql).toContain('CREATE TABLE "content_prev_test"')
    expect(existsSync(MIGRATIONS_FOLDER)).toBe(false)
  })

  it('leaves an existing folder exactly as it was, so a real run generates the same migration', async () => {
    // MUTATION: delete only the new .sql files. drizzle-kit's snapshot and
    // journal entry then stay, and the real run that follows the preview
    // generates nothing, because drizzle-kit thinks the change is recorded.
    await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    writeFileSync(SCHEMA_PATH, generateSchemaFile(registryWith([NOTE])))
    const before = folderState()

    const preview = await previewMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(preview).toHaveLength(1)
    expect(preview[0]!.sql).toContain('ADD COLUMN "note"')
    expect(folderState()).toEqual(before)

    const real = await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(real).toHaveLength(1)
    expect(readFileSync(path.join(MIGRATIONS_FOLDER, real[0]!), 'utf8')).toBe(preview[0]!.sql)
  })

  it('restores the folder when the preview fails after drizzle-kit has written', async () => {
    // MUTATION: restore only after a successful read (no finally). The files
    // drizzle-kit wrote then stay behind when reading them fails.
    await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    writeFileSync(SCHEMA_PATH, generateSchemaFile(registryWith([NOTE])))
    const before = folderState()
    const existing = new Set(Object.keys(before))
    const realReadFile = fsPromises.readFile
    let failed = false
    const spy = vi.spyOn(fsPromises, 'readFile').mockImplementation(((file: string, ...rest: unknown[]) => {
      const name = path.basename(String(file))
      if (!failed && name.endsWith('.sql') && !existing.has(name)) {
        failed = true // the preview's read of the new file; later reads succeed
        return Promise.reject(new Error('read failed'))
      }
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(file, ...rest)
    }) as typeof fsPromises.readFile)

    try {
      await expect(previewMigration(CONFIG_PATH, MIGRATIONS_FOLDER)).rejects.toThrow('read failed')
    } finally {
      spy.mockRestore()
    }
    expect(failed).toBe(true)
    expect(folderState()).toEqual(before)
  })
})
