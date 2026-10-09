import { sql } from 'drizzle-orm'
import { parseSchema, buildSchemaRegistry, hashPassword } from '@bobbykim/manguito-cms-core'
import type {
  ParsedField,
  ParsedSchema,
  SchemaRegistry,
  SystemField,
} from '@bobbykim/manguito-cms-core'
import { seedSystemTables } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { testParsedSchema, testRoleUsers } from '@bobbykim/manguito-cms-test-utils'

// Shared fixture for the relation-cardinality suites. The registry is built
// through core's real parser (PLAN-QUALITY rule 4), so every ui_component.rel,
// db_column and foreign-key delete rule is what a real schema produces. The
// table SQL is derived from that parsed output, not restated, so a change to a
// delete rule reaches these tables.
//
// Each suite passes its own prefix: vitest runs files in parallel, and every
// type name, table and base path below derives from the prefix.

export type CardinalityFixture = {
  registry: SchemaRegistry
  basePath: string
  names: { post: string; tag: string; link: string; card: string }
  tables: { post: string; tag: string; link: string; card: string; tags: string }
}

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type' | 'paragraph-type'): ParsedSchema {
  const result = parseSchema(raw, type, `${type}.json`)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

export function makeCardinalityFixture(prefix: string): CardinalityFixture {
  const names = {
    post: `content--${prefix}_post`,
    tag: `taxonomy--${prefix}_tag`,
    link: `paragraph--${prefix}_link`,
    card: `paragraph--${prefix}_card`,
  }
  const basePath = `${prefix}-posts`
  const registry = buildSchemaRegistry(
    [
      parseOrThrow(
        {
          name: names.tag,
          label: 'Tag',
          type: 'taxonomy-type',
          fields: [
            { name: 'name', label: 'Name', type: 'text/plain', required: false },
            { name: 'tag_link', label: 'Tag link', type: 'paragraph', ref: names.link, rel: 'one-to-one', required: false },
          ],
        },
        'taxonomy-type'
      ),
      parseOrThrow(
        { name: names.link, label: 'Link', type: 'paragraph-type', fields: [{ name: 'url', label: 'URL', type: 'text/plain', required: false }] },
        'paragraph-type'
      ),
      parseOrThrow(
        {
          name: names.card,
          label: 'Card',
          type: 'paragraph-type',
          fields: [
            { name: 'heading', label: 'Heading', type: 'text/plain', required: false },
            { name: 'card_link', label: 'Card link', type: 'paragraph', ref: names.link, rel: 'one-to-one', required: false },
            { name: 'card_tag', label: 'Card tag', type: 'reference', target: names.tag, rel: 'one-to-one', required: true },
          ],
        },
        'paragraph-type'
      ),
      parseOrThrow(
        {
          name: names.post,
          label: 'Post',
          type: 'content-type',
          default_base_path: basePath,
          only_one: false,
          fields: [
            {
              tab: {
                name: 'main',
                label: 'Main',
                fields: [
                  { name: 'title', label: 'Title', type: 'text/plain', required: false },
                  { name: 'link', label: 'Link', type: 'paragraph', ref: names.link, rel: 'one-to-one', required: false },
                  { name: 'cards', label: 'Cards', type: 'paragraph', ref: names.card, rel: 'one-to-many', required: false },
                  { name: 'category', label: 'Category', type: 'reference', target: names.tag, rel: 'one-to-many', required: false },
                  { name: 'owner', label: 'Owner', type: 'reference', target: names.tag, rel: 'one-to-one', required: true },
                  { name: 'tags', label: 'Tags', type: 'reference', target: names.tag, rel: 'many-to-many', required: false },
                ],
              },
            },
          ],
        },
        'content-type'
      ),
    ],
    { base_paths: [] },
    testParsedSchema.roles
  )
  const post = registry.content_types[names.post]!
  return {
    registry,
    basePath,
    names,
    tables: {
      post: post.db.table_name,
      tag: registry.taxonomy_types[names.tag]!.db.table_name,
      link: registry.paragraph_types[names.link]!.db.table_name,
      card: registry.paragraph_types[names.card]!.db.table_name,
      tags: post.fields.find((f) => f.name === 'tags')!.db_column!.junction!.table_name,
    },
  }
}

const PG_TYPE: Record<string, string> = {
  uuid: 'uuid', varchar: 'varchar', text: 'text', integer: 'integer',
  decimal: 'numeric', boolean: 'boolean', timestamp: 'timestamp',
}

function tableSql(table: string, systemFields: SystemField[], fields: ParsedField[]): string {
  const cols = systemFields.map(
    (s) =>
      `"${s.name}" ${PG_TYPE[s.db_type]}` +
      (s.primary_key ? ' PRIMARY KEY' : '') +
      (s.default ? ` DEFAULT ${s.default}` : '') +
      (s.nullable ? '' : ' NOT NULL')
  )
  for (const f of fields) {
    const c = f.db_column
    if (!c || c.junction) continue
    let col = `"${c.column_name}" ${PG_TYPE[c.column_type]}` + (c.nullable ? '' : ' NOT NULL')
    if (c.foreign_key) {
      col += ` REFERENCES "${c.foreign_key.table}"("${c.foreign_key.column}") ON DELETE ${c.foreign_key.on_delete}`
    }
    cols.push(col)
  }
  return `CREATE TABLE "${table}" (${cols.join(', ')})`
}

export async function dropFixtureTables(db: DrizzlePostgresInstance, fx: CardinalityFixture): Promise<void> {
  for (const t of [fx.tables.tags, fx.tables.post, fx.tables.card, fx.tables.link, fx.tables.tag]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
  }
  await db.execute(sql`DELETE FROM base_paths WHERE path = ${fx.basePath}`)
}

export async function createFixtureTables(db: DrizzlePostgresInstance, fx: CardinalityFixture): Promise<void> {
  await dropFixtureTables(db, fx)
  const { registry: r, names: n, tables: t } = fx
  const tag = r.taxonomy_types[n.tag]!
  const post = r.content_types[n.post]!
  const link = r.paragraph_types[n.link]!
  const card = r.paragraph_types[n.card]!
  await db.execute(sql.raw(tableSql(t.tag, tag.system_fields, tag.fields)))
  await db.execute(sql.raw(tableSql(t.post, post.system_fields, post.fields)))
  await db.execute(sql.raw(tableSql(t.link, link.system_fields, link.fields)))
  await db.execute(sql.raw(tableSql(t.card, card.system_fields, card.fields)))
  const j = post.fields.find((f) => f.name === 'tags')!.db_column!.junction!
  await db.execute(
    sql.raw(
      `CREATE TABLE "${j.table_name}" ("${j.left_column}" uuid NOT NULL REFERENCES "${t.post}"(id) ON DELETE CASCADE, ` +
        `"${j.right_column}" uuid NOT NULL REFERENCES "${j.right_table}"(id) ON DELETE CASCADE` +
        (j.order_column ? ', "order" integer NOT NULL DEFAULT 0' : '') +
        ')'
    )
  )
  await db.execute(sql`INSERT INTO base_paths (name, path) VALUES (${fx.basePath}, ${fx.basePath}) ON CONFLICT (path) DO NOTHING`)
}

export async function insertTag(db: DrizzlePostgresInstance, fx: CardinalityFixture, name: string): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO ${sql.raw(`"${fx.tables.tag}"`)} (name, published) VALUES (${name}, true) RETURNING id`
  )
  return (r.rows[0] as { id: string }).id
}

export async function insertPost(
  db: DrizzlePostgresInstance,
  fx: CardinalityFixture,
  row: { slug: string; owner: string }
): Promise<string> {
  const bp = await db.execute(sql`SELECT id FROM base_paths WHERE path = ${fx.basePath}`)
  const basePathId = (bp.rows[0] as { id: string }).id
  const r = await db.execute(
    sql`INSERT INTO ${sql.raw(`"${fx.tables.post}"`)} (slug, base_path_id, published, owner)
        VALUES (${row.slug}, ${basePathId}, true, ${row.owner}) RETURNING id`
  )
  return (r.rows[0] as { id: string }).id
}

export async function insertParagraph(
  db: DrizzlePostgresInstance,
  table: string,
  row: { parentId: string; parentType: string; parentField: string; order: number; values: Record<string, unknown> }
): Promise<string> {
  const data: Record<string, unknown> = {
    parent_id: row.parentId,
    parent_type: row.parentType,
    parent_field: row.parentField,
    order: row.order,
    ...row.values,
  }
  const cols = sql.join(Object.keys(data).map((k) => sql.raw(`"${k}"`)), sql`, `)
  const vals = sql.join(Object.values(data).map((v) => sql`${v}`), sql`, `)
  const r = await db.execute(sql`INSERT INTO ${sql.raw(`"${table}"`)} (${cols}) VALUES (${vals}) RETURNING id`)
  return (r.rows[0] as { id: string }).id
}

export async function countRows(db: DrizzlePostgresInstance, table: string, where: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`))
  return (r.rows[0] as { n: number }).n
}

// Other suites truncate roles/users without restoring globalSetup's seed, and
// these suites authenticate as the seeded users, so they re-seed in beforeAll.
// Repeats globalSetup.ts steps 3-4.
export async function seedTestUsers(db: DrizzlePostgresInstance): Promise<void> {
  await seedSystemTables(db, testParsedSchema)
  for (const user of testRoleUsers) {
    const hash = await hashPassword(user.password)
    await db.execute(sql`DELETE FROM users WHERE id = ${user.id} OR email = ${user.email}`)
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
          SELECT ${user.id}, ${user.email}, ${hash}, r.id, ${user.token_version}, ${user.must_change_password}
          FROM roles r WHERE r.name = ${user.role}`,
    )
  }
}
