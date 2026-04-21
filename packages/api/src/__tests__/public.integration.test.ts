import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType } from '@bobbykim/manguito-cms-core'
import { createAPIAdapter } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import { createDrizzleContentRepository } from '../repositories/content'
import { registerPublicContentRoutes } from '../routes/content'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Table names (unique to this suite) ──────────────────────────────────────

const BLOG_TABLE = 'api_int_pub_blog'
const CATEGORY_TABLE = 'api_int_pub_category'
const BASE_PATH = 'pub-test-blog'

// ─── Schema fixtures ──────────────────────────────────────────────────────────

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'pub-test-blog',
  label: 'Public Test Blog',
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
      name: 'blog_title',
      label: 'Blog Title',
      field_type: 'text/plain',
      required: true,
      nullable: true,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'category',
      label: 'Category',
      field_type: 'reference',
      required: false,
      nullable: true,
      order: 1,
      validation: { required: false },
      db_column: { column_name: 'category_id', column_type: 'uuid', nullable: true },
      ui_component: { component: 'reference-select' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: BLOG_TABLE, junction_tables: [] },
  api: {
    default_base_path: BASE_PATH,
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: `/api/${BASE_PATH}/:slug`,
  },
}

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: { 'pub-test-blog': BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── DB lifecycle ─────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${CATEGORY_TABLE}" (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR         NOT NULL,
      published   BOOLEAN         NOT NULL DEFAULT false,
      created_at  TIMESTAMP       NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP       NOT NULL DEFAULT NOW()
    )
  `))

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${BLOG_TABLE}" (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        VARCHAR         NOT NULL UNIQUE,
      published   BOOLEAN         NOT NULL DEFAULT false,
      blog_title  VARCHAR,
      category_id UUID,
      created_at  TIMESTAMP       NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP       NOT NULL DEFAULT NOW()
    )
  `))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${BLOG_TABLE}" CASCADE`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${CATEGORY_TABLE}" CASCADE`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${BLOG_TABLE}" RESTART IDENTITY CASCADE`))
  await db.execute(sql.raw(`TRUNCATE TABLE "${CATEGORY_TABLE}" RESTART IDENTITY CASCADE`))
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const { app } = createAPIAdapter({
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
  })
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('public content routes — integration', () => {
  it('GET /api/{base_path} returns only published items with correct pagination meta', async () => {
    const app = makeApp()

    await db.execute(sql.raw(`
      INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title) VALUES
        ('post-1', true,  'Post 1'),
        ('post-2', true,  'Post 2'),
        ('post-3', true,  'Post 3'),
        ('draft-1', false, 'Draft 1')
    `))

    const res = await app.request(`/api/${BASE_PATH}`)
    expect(res.status).toBe(200)

    const body = await res.json() as {
      ok: boolean
      data: unknown[]
      meta: {
        total: number
        page: number
        per_page: number
        total_pages: number
        has_next: boolean
        has_prev: boolean
      }
    }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(3)
    expect(body.meta.total).toBe(3)
    expect(body.meta.page).toBe(1)
    expect(body.meta.per_page).toBe(10)
    expect(body.meta.total_pages).toBe(1)
    expect(body.meta.has_next).toBe(false)
    expect(body.meta.has_prev).toBe(false)
  })

  it('GET /api/{base_path}/{slug} returns item by slug', async () => {
    const app = makeApp()

    await db.execute(sql.raw(`
      INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title)
      VALUES ('my-post', true, 'My Post')
    `))

    const res = await app.request(`/api/${BASE_PATH}/my-post`)
    expect(res.status).toBe(200)

    const body = await res.json() as {
      ok: boolean
      data: { slug: string; published: boolean; blog_title: string }
    }
    expect(body.ok).toBe(true)
    expect(body.data.slug).toBe('my-post')
    expect(body.data.published).toBe(true)
    expect(body.data.blog_title).toBe('My Post')
  })

  it('GET /api/{base_path}/nonexistent-slug returns 404 SLUG_NOT_FOUND', async () => {
    const app = makeApp()

    const res = await app.request(`/api/${BASE_PATH}/nonexistent-slug`)
    expect(res.status).toBe(404)

    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('SLUG_NOT_FOUND')
  })

  it('GET /api/{base_path} with ?include=<relation> returns expanded relation', async () => {
    // Uses registerPublicContentRoutes directly with a repo that has relations configured,
    // since createAPIAdapter does not yet wire relation options to content repos.
    const catResult = await db.execute(sql.raw(`
      INSERT INTO "${CATEGORY_TABLE}" (name, published)
      VALUES ('Technology', true)
      RETURNING id
    `))
    const catId = (catResult.rows[0] as { id: string }).id

    await db.execute(sql`
      INSERT INTO ${sql.raw(`"${BLOG_TABLE}"`)} (slug, published, blog_title, category_id)
      VALUES ('with-category', true, 'Blog With Category', ${catId}::uuid)
    `)

    const blogRepo = createDrizzleContentRepository(db, BLOG_TABLE, {
      relations: {
        category: {
          type: 'reference',
          table: CATEGORY_TABLE,
          fk_column: 'category_id',
        },
      },
    })

    const app = new Hono()
    registerPublicContentRoutes(app, TEST_REGISTRY, { 'pub-test-blog': blogRepo })

    const res = await app.request(`/api/${BASE_PATH}?include=category`)
    expect(res.status).toBe(200)

    const body = await res.json() as {
      ok: boolean
      data: { slug: string; category: { id: string; name: string } | null }[]
    }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)

    const item = body.data[0]!
    expect(item.slug).toBe('with-category')
    expect(item.category).not.toBeNull()
    expect(typeof item.category).toBe('object')
    expect(item.category!.id).toBe(catId)
    expect(item.category!.name).toBe('Technology')
  })

  it('GET /api/openapi.json returns valid OpenAPI 3.0 JSON with openapi, info, paths keys', async () => {
    const app = makeApp()

    const res = await app.request('/api/openapi.json')
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    expect(typeof body['openapi']).toBe('string')
    expect((body['openapi'] as string).startsWith('3.')).toBe(true)
    expect(body['info']).toBeDefined()
    expect(typeof body['info']).toBe('object')
    expect(body['paths']).toBeDefined()
    expect(typeof body['paths']).toBe('object')
  })
})
