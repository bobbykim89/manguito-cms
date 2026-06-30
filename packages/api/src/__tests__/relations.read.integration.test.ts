import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedParagraphType,
  ParsedRole,
} from '@bobbykim/manguito-cms-core'
import { createDrizzleContentRepository } from '../repositories/content'
import { registerPublicContentRoutes } from '../routes/content'

// Characterizes paragraph + junction relation reads (resolved via ?include= and
// bare ids without it), which no other integration test exercises. This is the
// safety net for consolidating the read resolvers — assertions capture CURRENT
// behaviour so a refactor that preserves it stays green.

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

const POST_TABLE = 'api_int_rel_post'
const PARA_TABLE = 'api_int_rel_quote'
const JUNC_TABLE = 'api_int_rel_post_tags'
const CAT_TABLE = 'api_int_rel_category'
const BASE_PATH = 'rel-test-post'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const QUOTE_TYPE: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--rel_quote',
  label: 'Quote',
  source_file: 'test.yml',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'parent_id', db_type: 'uuid', nullable: false },
    { name: 'parent_type', db_type: 'varchar', nullable: false },
    { name: 'parent_field', db_type: 'varchar', nullable: false },
    { name: 'order', db_type: 'integer', default: '0', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    {
      name: 'quote', label: 'Quote', field_type: 'text/plain',
      required: true, nullable: false, order: 0,
      validation: { required: true },
      db_column: { column_name: 'quote', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: PARA_TABLE },
}

const POST_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'rel-test-post',
  label: 'Relation Test Post',
  source_file: 'test.yml',
  only_one: false,
  default_base_path: BASE_PATH,
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    {
      name: 'title', label: 'Title', field_type: 'text/plain',
      required: true, nullable: false, order: 0,
      validation: { required: true },
      db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'category', label: 'Category', field_type: 'reference',
      required: false, nullable: true, order: 1,
      validation: { required: false },
      db_column: {
        column_name: 'category_id', column_type: 'uuid', nullable: true,
        foreign_key: { table: CAT_TABLE, column: 'id', on_delete: 'SET NULL' },
      },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'one-to-one' },
    },
    {
      name: 'tags', label: 'Tags', field_type: 'reference',
      required: false, nullable: true, order: 2,
      validation: { required: false },
      db_column: {
        column_name: '', column_type: 'uuid', nullable: true,
        junction: {
          table_name: JUNC_TABLE, left_column: 'left_id', right_column: 'right_id',
          right_table: CAT_TABLE, order_column: false,
        },
      },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'many-to-many' },
    },
    {
      name: 'quotes', label: 'Quotes', field_type: 'paragraph',
      required: false, nullable: true, order: 3,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--rel_quote', rel: 'one-to-many' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: POST_TABLE, junction_tables: [] },
  api: {
    default_base_path: BASE_PATH,
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: `/api/${BASE_PATH}/:slug`,
  },
}

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'viewer', label: 'Viewer', is_system: true, hierarchy_level: 4, permissions: [] },
]

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { 'rel-test-post': POST_TYPE },
  paragraph_types: { 'paragraph--rel_quote': QUOTE_TYPE },
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

const POST_RELATIONS = {
  category: { type: 'reference', table: CAT_TABLE, fk_column: 'category_id' } as const,
  tags: {
    type: 'junction', table: CAT_TABLE, junction_table: JUNC_TABLE,
    left_column: 'left_id', right_column: 'right_id', order_column: false,
  } as const,
  quotes: { type: 'paragraph', table: PARA_TABLE } as const,
}

// ─── DB lifecycle ─────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${CAT_TABLE}" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR NOT NULL,
      published BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${POST_TABLE}" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR NOT NULL UNIQUE,
      published BOOLEAN NOT NULL DEFAULT false,
      title VARCHAR,
      category_id UUID,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${PARA_TABLE}" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id UUID NOT NULL,
      parent_type VARCHAR NOT NULL,
      parent_field VARCHAR NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      quote VARCHAR,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${JUNC_TABLE}" (
      left_id UUID NOT NULL,
      right_id UUID NOT NULL
    )`))
}, 30_000)

afterAll(async () => {
  for (const t of [POST_TABLE, PARA_TABLE, JUNC_TABLE, CAT_TABLE]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
  }
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  for (const t of [POST_TABLE, PARA_TABLE, JUNC_TABLE, CAT_TABLE]) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`))
  }
})

// ─── Seeding ──────────────────────────────────────────────────────────────────

async function seedPostWithRelations(): Promise<{ postId: string; catA: string; catB: string }> {
  const cat = await db.execute(sql.raw(`
    INSERT INTO "${CAT_TABLE}" (name, published) VALUES ('Tech', true), ('News', true) RETURNING id`))
  const catA = (cat.rows[0] as { id: string }).id
  const catB = (cat.rows[1] as { id: string }).id

  const post = await db.execute(sql`
    INSERT INTO ${sql.raw(`"${POST_TABLE}"`)} (slug, published, title, category_id)
    VALUES ('with-rels', true, 'With Relations', ${catA}::uuid) RETURNING id`)
  const postId = (post.rows[0] as { id: string }).id

  // two paragraph rows, ordered
  await db.execute(sql`
    INSERT INTO ${sql.raw(`"${PARA_TABLE}"`)} (parent_id, parent_type, parent_field, "order", quote)
    VALUES (${postId}::uuid, 'rel-test-post', 'quotes', 0, 'First quote'),
           (${postId}::uuid, 'rel-test-post', 'quotes', 1, 'Second quote')`)

  // two junction rows (tags → both categories)
  await db.execute(sql`
    INSERT INTO ${sql.raw(`"${JUNC_TABLE}"`)} (left_id, right_id)
    VALUES (${postId}::uuid, ${catA}::uuid), (${postId}::uuid, ${catB}::uuid)`)

  return { postId, catA, catB }
}

function publicApp() {
  const repo = createDrizzleContentRepository(db, POST_TABLE, { relations: POST_RELATIONS })
  const app = new Hono()
  registerPublicContentRoutes(app, TEST_REGISTRY, { 'rel-test-post': repo })
  return app
}

type PostRow = {
  slug: string
  category: unknown
  tags: unknown
  quotes: unknown
}

// ─── Resolved reads (?include=) ───────────────────────────────────────────────

describe('relation reads — resolved via ?include=', () => {
  it('paragraph field resolves to full ordered rows', async () => {
    await seedPostWithRelations()
    const res = await publicApp().request(`/api/${BASE_PATH}/with-rels?include=quotes`)
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: PostRow }
    const quotes = data.quotes as { quote: string; order: number }[]
    expect(Array.isArray(quotes)).toBe(true)
    expect(quotes).toHaveLength(2)
    expect(quotes.map((q) => q.quote)).toEqual(['First quote', 'Second quote'])
  })

  it('junction field resolves to full target rows', async () => {
    const { catA, catB } = await seedPostWithRelations()
    const res = await publicApp().request(`/api/${BASE_PATH}/with-rels?include=tags`)
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: PostRow }
    const tags = data.tags as { id: string; name: string }[]
    expect(Array.isArray(tags)).toBe(true)
    expect(tags.map((t) => t.id).sort()).toEqual([catA, catB].sort())
    expect(tags.map((t) => t.name).sort()).toEqual(['News', 'Tech'])
  })

  it('reference field resolves to the full target row', async () => {
    const { catA } = await seedPostWithRelations()
    const res = await publicApp().request(`/api/${BASE_PATH}/with-rels?include=category`)
    const { data } = await res.json() as { data: PostRow }
    const category = data.category as { id: string; name: string }
    expect(category.id).toBe(catA)
    expect(category.name).toBe('Tech')
  })
})

// ─── Bare reads (no ?include=) ────────────────────────────────────────────────

describe('relation reads — bare ids without ?include=', () => {
  it('paragraph and junction fields come back as bare id arrays', async () => {
    const { catA, catB } = await seedPostWithRelations()
    const res = await publicApp().request(`/api/${BASE_PATH}/with-rels`)
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: PostRow }

    const quotes = data.quotes as string[]
    expect(Array.isArray(quotes)).toBe(true)
    expect(quotes).toHaveLength(2)
    expect(quotes.every((q) => typeof q === 'string')).toBe(true)

    const tags = data.tags as string[]
    expect(tags.map(String).sort()).toEqual([catA, catB].sort())
  })

  it('reference field bare id stays under the raw fk column, not the field name', async () => {
    // A foreign-key reference already carries its id as a real column (category_id)
    // from SELECT *, so the bare resolver leaves it there — the field name is unset.
    const { catA } = await seedPostWithRelations()
    const res = await publicApp().request(`/api/${BASE_PATH}/with-rels`)
    const { data } = await res.json() as { data: PostRow & { category_id: string } }
    expect(data.category_id).toBe(catA)
    expect(data.category).toBeUndefined()
  })
})
