import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { parseSchema, buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { ParsedSchema, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { getTestDb } from '@bobbykim/manguito-cms-test-utils'
import { codegenForeignKeyName, foreignKeyName } from '../constraint-names'
import { generateSchemaFile } from '../codegen/index'
import { ensureLinkConstraints, linkUniqueName } from '../link-tables'
import type { DrizzlePostgresInstance } from '../types'

// The test database is shared by every package's tests. Every push below is
// restricted by `tablesFilter` to this file's own tables; an unfiltered push
// would drop all the others.

const TMP_DIR = path.resolve(__dirname, '..', '..', 'tests', '.tmp-ensure-link')
const DRIZZLE_KIT = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'drizzle-kit')

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function tag(prefix: string): ParsedSchema {
  return parseOrThrow(
    { name: `taxonomy--${prefix}_tag`, label: 'Tag', type: 'taxonomy-type', fields: [{ name: 'name', label: 'Name', type: 'text/plain', required: false }] },
    'taxonomy-type',
    'tag.json'
  )
}

function post(prefix: string, manyFields: string[]): ParsedSchema {
  return parseOrThrow(
    {
      name: `content--${prefix}_post`,
      label: 'Post',
      type: 'content-type',
      default_base_path: `${prefix}-posts`,
      only_one: false,
      fields: [{ tab: { name: 'main', label: 'Main', fields: manyFields.map((name) => (
        { name, label: name, type: 'reference', target: `taxonomy--${prefix}_tag`, rel: 'many-to-many', required: false }
      )) } }],
    },
    'content-type',
    'post.json'
  )
}

function build(schemas: ParsedSchema[]): SchemaRegistry {
  return buildSchemaRegistry(schemas, { base_paths: [] }, { roles: [], valid_permissions: [] })
}

function linkTables(registry: SchemaRegistry): string[] {
  return Object.values(registry.content_types).flatMap((t) => t.db.junction_tables.map((j) => j.table_name))
}

// 'junction_content_lu2_post_' is 26 characters; the field name pads the link
// table to 60, where a plain `_unique` suffix would pass 63 (Review Focus 1).
const LONG_FIELD = 'x'.repeat(34)

const main = build([tag('lu2'), post('lu2', ['tags', LONG_FIELD])])
const [TAGS_LINK, LONG_LINK] = linkTables(main) as [string, string]
// A short link table in its own fixture, for the push check below.
const settled = build([tag('lu4'), post('lu4', ['tags'])])
const [SETTLED_LINK] = linkTables(settled) as [string]
const empty = build([tag('lu2')])
// A project from before #75: its link table has no order column.
const legacy = build([tag('lu3'), post('lu3', ['tags'])])
const [LEGACY_LINK] = linkTables(legacy) as [string]

// Long foreign-key names (#88): a link table whose foreign keys pass 63 characters.
const renamed = build([tag('lu5'), post('lu5', ['linked_tags_for_the_long_names'])])
const [RENAMED_LINK] = linkTables(renamed) as [string]

let db: DrizzlePostgresInstance

function writeConfig(dir: string, registry: SchemaRegistry, filters: string[], stripUnique: boolean): string {
  mkdirSync(dir, { recursive: true })
  // tablesFilter only narrows what push reads from the database; push still
  // plans every table in the schema file. Drop the system tables, which these
  // fixtures never reference, so push touches nothing but this file's tables.
  let schema = generateSchemaFile(registry).replace(
    /\/\/ ─── System Tables[\s\S]*?(?=\/\/ ─── (?!System))/,
    ''
  )
  // Models the old codegen: the same tables without the unique callbacks.
  if (stripUnique) schema = schema.replace(/^\s*pair: s\.unique\(.*\n/gm, '')
  writeFileSync(path.join(dir, 'schema.ts'), schema)
  const url = JSON.stringify(process.env['DB_URL'])
  const config = path.join(dir, 'drizzle.config.ts')
  writeFileSync(
    config,
    [
      "import { defineConfig } from 'drizzle-kit'",
      'export default defineConfig({',
      "  schema: './schema.ts',",
      "  dialect: 'postgresql',",
      `  dbCredentials: { url: ${url} },`,
      `  tablesFilter: ${JSON.stringify(filters)},`,
      '  verbose: true,',
      '})',
    ].join('\n')
  )
  return config
}

function push(config: string): string {
  const result = spawnSync(DRIZZLE_KIT, ['push', `--config=${config}`], {
    cwd: path.dirname(config),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
  })
  return `${result.stdout}${result.stderr}`
}

async function dropAll() {
  for (const t of [...linkTables(main), LEGACY_LINK, SETTLED_LINK, 'content_lu4_post', 'taxonomy_lu4_tag', 'content_lu2_post', 'taxonomy_lu2_tag', 'content_lu3_post', 'taxonomy_lu3_tag', RENAMED_LINK, 'content_lu5_post', 'taxonomy_lu5_tag']) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
  }
}

async function constraintExists(table: string, name: string): Promise<boolean> {
  const r = await db.execute(sql.raw(`SELECT 1 FROM pg_constraint WHERE conrelid = '"${table}"'::regclass AND conname = '${name}'`))
  return r.rows.length > 0
}

async function count(table: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`))
  return (r.rows[0] as { n: number }).n
}

async function insertOwners(post: string, tagTable: string): Promise<{ p: string; a: string; b: string }> {
  const p = (await db.execute(sql.raw(`INSERT INTO "${post}" (slug, base_path_id) VALUES ('s-' || gen_random_uuid(), gen_random_uuid()) RETURNING id`))).rows[0] as { id: string }
  const a = (await db.execute(sql.raw(`INSERT INTO "${tagTable}" DEFAULT VALUES RETURNING id`))).rows[0] as { id: string }
  const b = (await db.execute(sql.raw(`INSERT INTO "${tagTable}" DEFAULT VALUES RETURNING id`))).rows[0] as { id: string }
  return { p: p.id, a: a.id, b: b.id }
}

beforeAll(async () => {
  expect(LONG_LINK.length).toBe(60)
  db = await getTestDb()
  await dropAll()
  push(writeConfig(path.join(TMP_DIR, 'main'), main, ['*lu2_*'], true))
  push(writeConfig(path.join(TMP_DIR, 'legacy'), legacy, ['*lu3_*'], true))
  // Drop the order column to model the pre-#75 link table.
  await db.execute(sql.raw(`ALTER TABLE "${LEGACY_LINK}" DROP COLUMN "order"`))
}, 120_000)

afterAll(async () => {
  await dropAll()
  rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('ensureLinkConstraints', () => {
  it('removes duplicate pairs, adds the constraint under its codegen name, and a second run does nothing', async () => {
    // MUTATION: skip the clean-up and run only the ADD CONSTRAINT. The
    // duplicates make Postgres reject it with a unique-index error.
    const { p, a, b } = await insertOwners('content_lu2_post', 'taxonomy_lu2_tag')
    for (const link of [TAGS_LINK, LONG_LINK]) {
      await db.execute(sql.raw(
        `INSERT INTO "${link}" (left_id, right_id, "order") VALUES ('${p}','${a}',1),('${p}','${a}',2),('${p}','${a}',3),('${p}','${b}',0)`
      ))
    }
    const first = await ensureLinkConstraints(db, main)
    expect(first).toEqual([
      { table: TAGS_LINK, removed: 2 },
      { table: LONG_LINK, removed: 2 },
    ])
    expect(await count(TAGS_LINK)).toBe(2)
    const kept = await db.execute(sql.raw(`SELECT "order" FROM "${TAGS_LINK}" WHERE right_id = '${a}'`))
    expect(kept.rows).toEqual([{ order: 1 }])
    expect(await constraintExists(TAGS_LINK, linkUniqueName(TAGS_LINK))).toBe(true)
    expect(await constraintExists(LONG_LINK, linkUniqueName(LONG_LINK))).toBe(true)

    expect(await ensureLinkConstraints(db, main)).toEqual([])
  })

  it('reads every link table\'s state in one query when every constraint exists', async () => {
    // MUTATION: one lookup per link table (to_regclass or pg_constraint per
    // table) gives 2 or 4 queries instead of 1.
    let calls = 0
    const counting = {
      ...db,
      execute: (q: Parameters<typeof db.execute>[0]) => {
        calls++
        return db.execute(q)
      },
    } as unknown as DrizzlePostgresInstance
    expect(await ensureLinkConstraints(counting, main)).toEqual([])
    expect(calls).toBe(1)
  })

  it('sends no query for a registry without link tables', async () => {
    // MUTATION: run the catalog query with an empty list of tables. That is
    // one query, not zero.
    let calls = 0
    const counting = {
      ...db,
      execute: (q: Parameters<typeof db.execute>[0]) => {
        calls++
        return db.execute(q)
      },
    } as unknown as DrizzlePostgresInstance
    expect(await ensureLinkConstraints(counting, empty)).toEqual([])
    expect(calls).toBe(0)
  })

  it('plans nothing for the 60-character link table', () => {
    // MUTATION: codegen keeps the inline `.references()` for long names. The
    // foreign keys are then named by drizzle, Postgres cuts them to 63
    // characters, and push plans to rename them, so "No changes detected" is
    // missing. The same wrong unique name (`<table>_left_id_right_id_unique`)
    // would also show up here as a planned UNIQUE.
    const out = push(writeConfig(path.join(TMP_DIR, 'long'), main, ['*lu2_*'], false))
    expect(out).toContain('No changes detected')
  })

  it('leaves drizzle-kit push with nothing to plan', async () => {
    // MUTATION: add the constraint under drizzle's default name
    // (`<table>_left_id_right_id_unique`) instead of linkUniqueName. Push then
    // sees a missing constraint, and the output lacks "No changes detected".
    //
    // This uses its own short-named link table: the 60-character one has
    // foreign-key names past 63 characters, which Postgres truncates, so push
    // keeps planning to rename them. That predates the unique constraint; the
    // long table's constraint is checked by name in the first test.
    push(writeConfig(path.join(TMP_DIR, 'settled'), settled, ['*lu4_*'], true))
    const { p, a } = await insertOwners('content_lu4_post', 'taxonomy_lu4_tag')
    await db.execute(sql.raw(
      `INSERT INTO "${SETTLED_LINK}" (left_id, right_id, "order") VALUES ('${p}','${a}',0),('${p}','${a}',1)`
    ))
    expect(await ensureLinkConstraints(db, settled)).toEqual([{ table: SETTLED_LINK, removed: 1 }])

    const out = push(writeConfig(path.join(TMP_DIR, 'settled-full'), settled, ['*lu4_*'], false))
    expect(out).toContain('No changes detected')
  })

  it('renames long foreign keys once on the first push after the upgrade, then plans nothing', async () => {
    // MUTATION: name foreign keys `<default>.slice(0, 63)`. That is what
    // Postgres stores for the old name, so the second push plans nothing and
    // the hashed names never appear.
    //
    // Models the old database: codegen differed from the current one only in
    // the foreign-key names. Postgres cuts a renamed constraint to 63
    // characters, which is what the old codegen left behind.
    const config = writeConfig(path.join(TMP_DIR, 'renamed'), renamed, ['*lu5_*'], false)
    push(config)
    const foreignKeys = async () =>
      (await db.execute(sql.raw(
        `SELECT conname, confdeltype, conkey::text AS conkey, confrelid::regclass::text AS confrelid FROM pg_constraint WHERE conrelid = '"${RENAMED_LINK}"'::regclass AND contype = 'f' ORDER BY conkey::text`
      ))).rows as { conname: string; confdeltype: string; conkey: string; confrelid: string }[]

    const hashed = [
      codegenForeignKeyName(RENAMED_LINK, 'left_id', 'content_lu5_post', 'id'),
      codegenForeignKeyName(RENAMED_LINK, 'right_id', 'taxonomy_lu5_tag', 'id'),
    ]
    const defaults = [
      foreignKeyName(RENAMED_LINK, 'left_id', 'content_lu5_post', 'id'),
      foreignKeyName(RENAMED_LINK, 'right_id', 'taxonomy_lu5_tag', 'id'),
    ]
    expect(defaults.every((n) => n.length > 63)).toBe(true)
    const before = await foreignKeys()
    expect(before.map((r) => r.conname).sort()).toEqual([...hashed].sort())
    for (const [i, old] of defaults.entries()) {
      await db.execute(sql.raw(`ALTER TABLE "${RENAMED_LINK}" RENAME CONSTRAINT "${hashed[i]}" TO "${old}"`))
    }
    expect((await foreignKeys()).map((r) => r.conname).sort()).toEqual(defaults.map((n) => n.slice(0, 63)).sort())

    push(config)
    const after = await foreignKeys()
    expect(after.map((r) => r.conname).sort()).toEqual([...hashed].sort())
    const shape = (rows: typeof before) => rows.map(({ conkey, confrelid, confdeltype }) => ({ conkey, confrelid, confdeltype }))
    expect(shape(after)).toEqual(shape(before))
    expect(after.every((r) => r.confdeltype === 'c')).toBe(true)

    expect(push(config)).toContain('No changes detected')
  })

  it('skips a link table the registry lists but the database lacks', async () => {
    // MUTATION: drop the catalog query's existence filter (the pg_class join). The dedupe then fails on the
    // missing relation and the call throws.
    await db.execute(sql.raw(`DROP TABLE "${LONG_LINK}"`))
    await db.execute(sql.raw(`ALTER TABLE "${TAGS_LINK}" DROP CONSTRAINT "${linkUniqueName(TAGS_LINK)}"`))
    expect(await ensureLinkConstraints(db, main)).toEqual([{ table: TAGS_LINK, removed: 0 }])
  })

  it('cleans a link table that has no order column, keeping one row per pair', async () => {
    // MUTATION: assume the order column exists. The dedupe then references
    // "order", which this table lacks, and the call throws.
    const { p, a } = await insertOwners('content_lu3_post', 'taxonomy_lu3_tag')
    await db.execute(sql.raw(
      `INSERT INTO "${LEGACY_LINK}" (left_id, right_id) VALUES ('${p}','${a}'),('${p}','${a}')`
    ))
    expect(await ensureLinkConstraints(db, legacy)).toEqual([{ table: LEGACY_LINK, removed: 1 }])
    expect(await count(LEGACY_LINK)).toBe(1)
  })

  it('returns nothing and alters nothing for a registry without link tables', async () => {
    // MUTATION: look up link tables by a name pattern in the database rather
    // than from the registry; it then finds the other tests' lu2/lu3/lu4 link
    // tables and the returned list is not empty. (Weakest test of the set: a
    // boundary guard, it cannot be run red against a one-line change.)
    expect(await ensureLinkConstraints(db, empty)).toEqual([])
  })
})
