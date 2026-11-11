import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import ts from 'typescript'
import { sql } from 'drizzle-orm'
import { PgDialect, getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '../../adapters/postgres'
import type { DrizzlePostgresInstance } from '../../types'
import { generateSchemaFile } from '../index'

const DB_URL = process.env['DB_URL']

if (!DB_URL) {
  throw new Error('DB_URL must be set in .env.test before running integration tests')
}

// #96: core accepts any non-empty string as an enum value, and codegen writes
// each value into a SQL string inside the generated sql`` template.
const VALUES = [`don't know`, 'back`tick', 'dollar ${x}', 'back\\slash', 'plain']

const TABLE = 'content_eq_post'
const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-enum-quoting')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')

function registryWithEnum(values: string[]): SchemaRegistry {
  return {
    routes: { base_paths: [] },
    roles: { roles: [], valid_permissions: [] },
    schemas: {},
    content_types: {
      eq_post: {
        schema_type: 'content-type',
        name: 'eq_post',
        label: 'Post',
        source_file: 'eq_post.json',
        only_one: false,
        default_base_path: 'content',
        system_fields: [{ name: 'id', db_type: 'uuid', primary_key: true, nullable: false }],
        fields: [
          {
            name: 'status',
            label: 'Status',
            field_type: 'enum',
            required: true,
            nullable: false,
            order: 0,
            validation: { required: true, allowed_values: values },
            db_column: { column_name: 'status', column_type: 'varchar', nullable: false, check_constraint: values },
            ui_component: { component: 'select', options: values },
          },
        ],
        ui: { tabs: [] },
        db: { table_name: TABLE, junction_tables: [] },
        api: {
          default_base_path: 'content',
          http_methods: ['GET'],
          collection_path: '/content/eq_post',
          item_path: '/content/eq_post/:slug',
        },
      },
    },
    paragraph_types: {},
    taxonomy_types: {},
    enum_types: {},
    all_schemas: [],
  } as unknown as SchemaRegistry
}

let db: DrizzlePostgresInstance
const adapter = createPostgresAdapter({ url: DB_URL })

async function dropTable(): Promise<void> {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
}

beforeAll(async () => {
  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })
  await adapter.connect()
  db = adapter.getDb()
  await dropTable()
})

afterAll(async () => {
  await dropTable()
  await adapter.disconnect()
  rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('generated enum check constraints quote their values safely', () => {
  it('keeps schema.ts valid TypeScript when a value holds a backtick', () => {
    // MUTATION: drop the template-literal escaping. The backtick in "back`tick"
    // then ends the generated sql`` template and schema.ts no longer parses.
    const code = generateSchemaFile(registryWithEnum(VALUES))
    const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'schema.ts' })
    expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  })

  it('applies on Postgres and admits exactly the declared values', async () => {
    // MUTATION: drop the doubling of `'`. "don't know" then ends the SQL string
    // early and CREATE TABLE fails. Dropping the `\` escaping turns
    // "back\slash" into "backslash", so inserting the real value is rejected.
    // Dropping the `${` escaping makes "dollar ${x}" an interpolation, and
    // importing schema.ts fails on the undefined `x`.
    writeFileSync(SCHEMA_PATH, generateSchemaFile(registryWithEnum(VALUES)))
    const schema = (await import(SCHEMA_PATH)) as Record<string, unknown>
    const table = Object.values(schema).find(
      (t) => typeof t === 'object' && t !== null && getTableConfig(t as PgTable).name === TABLE,
    ) as PgTable
    const [check] = getTableConfig(table).checks
    const checkSql = new PgDialect().sqlToQuery(check!.value).sql

    await db.execute(sql.raw(`CREATE TABLE "${TABLE}" ("status" varchar NOT NULL, CHECK (${checkSql}))`))
    for (const v of VALUES) {
      await db.execute(sql`INSERT INTO ${sql.identifier(TABLE)} ("status") VALUES (${v})`)
    }
    await expect(
      db.execute(sql`INSERT INTO ${sql.identifier(TABLE)} ("status") VALUES (${'dont know'})`),
    ).rejects.toMatchObject({ cause: { code: '23514' } })
  })
})
