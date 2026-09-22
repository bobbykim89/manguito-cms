import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import type { BakedVersionModel } from '../versions'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

const TABLE = 'api_int_gqlver_blog'
const TYPE_NAME = 'content--gqlver_blog'

// ─── Schema fixture ───────────────────────────────────────────────────────────
//
// `title` over column `blog_title` — label and column diverge, which is the
// only reason these tests can tell versions apart. `subtitle` over column
// `blog_sub` is CURRENT-ONLY: it does not exist in v1's projection, and it is
// what the leak probe below looks for. `legacy_desc` is a tombstone retaining
// column `blog_desc`, which v1 still exposes with a fallback.

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: TYPE_NAME,
  label: 'GraphQL Version Blog',
  source_file: 'test.yml',
  only_one: false,
  default_base_path: 'gqlver-blog',
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
      required: false, nullable: true, order: 0, validation: { required: false },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'subtitle', label: 'Subtitle', field_type: 'text/plain',
      required: false, nullable: true, order: 1, validation: { required: false },
      db_column: { column_name: 'blog_sub', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'legacy_desc', label: 'Legacy Description', field_type: 'text/plain',
      required: false, nullable: true, order: 2, validation: { required: false },
      db_column: { column_name: 'blog_desc', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
      removed: true,
    },
  ],
  ui: { tabs: [] },
  db: { table_name: TABLE, junction_tables: [] },
  api: {
    default_base_path: 'gqlver-blog',
    http_methods: ['GET'],
    item_path: '/api/gqlver-blog/:slug',
  },
}

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { [TYPE_NAME]: BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// v1: the original name, plus the since-tombstoned column with a fallback, and
// NO subtitle — it predates that field. v3 (current): the renamed label and
// subtitle, and no blog_desc.
const MODEL: BakedVersionModel = {
  current: 'v3',
  live: ['v1', 'v3'],
  projections: {
    v1: {
      version: 'v1',
      types: {
        [TYPE_NAME]: {
          fields: [
            { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
            { column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: 'NO DESC' },
          ],
        },
      },
    },
    v3: {
      version: 'v3',
      types: {
        [TYPE_NAME]: {
          fields: [
            { column_name: 'blog_title', exposed_as: 'title', required: false },
            { column_name: 'blog_sub', exposed_as: 'subtitle', required: false },
          ],
        },
      },
    },
  },
}

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        VARCHAR   NOT NULL UNIQUE,
      published   BOOLEAN   NOT NULL DEFAULT false,
      blog_title  VARCHAR,
      blog_sub    VARCHAR,
      blog_desc   VARCHAR,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${TABLE}" RESTART IDENTITY CASCADE`))
  // blog_desc is NULL — a row written after the column stopped being written,
  // which is exactly when v1 must serve the declared fallback.
  await db.execute(sql.raw(`
    INSERT INTO "${TABLE}" (slug, published, blog_title, blog_sub, blog_desc)
    VALUES ('hello-world', true, 'Hello', 'Sub', NULL)
  `))
})

function app() {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: REGISTRY,
    db,
    versions: MODEL,
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
  })
  return app
}

async function query(path: string, source: string) {
  const res = await app().fetch(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source }),
  }))
  return { status: res.status, headers: res.headers, body: await res.json() }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('versioned GraphQL — the feature', () => {
  it('serves one column under each version’s own field name', async () => {
    const v1 = await query('/graphql/v1', '{ gqlverBlogs { data { blogTitle } } }')
    expect(v1.body.errors).toBeUndefined()
    expect(v1.body.data.gqlverBlogs.data[0].blogTitle).toBe('Hello')

    const v3 = await query('/graphql/v3', '{ gqlverBlogs { data { title } } }')
    expect(v3.body.errors).toBeUndefined()
    expect(v3.body.data.gqlverBlogs.data[0].title).toBe('Hello')
  })

  it("rejects the other version's field name on each endpoint", async () => {
    const v1 = await query('/graphql/v1', '{ gqlverBlogs { data { title } } }')
    expect(v1.body.errors).toBeDefined()

    const v3 = await query('/graphql/v3', '{ gqlverBlogs { data { blogTitle } } }')
    expect(v3.body.errors).toBeDefined()
  })

  it('serves current’s shape on the unversioned endpoint', async () => {
    const res = await query('/graphql', '{ gqlverBlogs { data { title subtitle } } }')
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.gqlverBlogs.data[0].title).toBe('Hello')
  })
})

describe('versioned GraphQL — no leakage across versions', () => {
  it('does not expose a column added after v1 was cut', async () => {
    // 2d's Critical, in GraphQL's form. `subtitle` is live in current and
    // absent from v1's projection; if the schema were built from the registry
    // rather than the view, v1 would serve it.
    const res = await query('/graphql/v1', '{ gqlverBlogs { data { subtitle } } }')

    expect(res.body.errors).toBeDefined()
    expect(JSON.stringify(res.body)).not.toContain('Sub')
  })

  it('does not expose a tombstoned column on current', async () => {
    const res = await query('/graphql/v3', '{ gqlverBlogs { data { legacyDesc } } }')
    expect(res.body.errors).toBeDefined()
  })

  it('serves the retained column on v1, with the declared fallback', async () => {
    // The row's blog_desc is NULL. v1 still serves the column, so it must
    // present the fallback rather than null.
    const res = await query('/graphql/v1', '{ gqlverBlogs { data { blogDesc } } }')
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.gqlverBlogs.data[0].blogDesc).toBe('NO DESC')
  })
})

describe('versioned GraphQL — introspection tells a pinned consumer what breaks', () => {
  const INTROSPECT = `{
    __type(name: "GqlverBlog") {
      fields(includeDeprecated: true) {
        name
        isDeprecated
        deprecationReason
      }
    }
  }`

  it('marks v1’s renamed field deprecated, naming current’s label', async () => {
    const res = await query('/graphql/v1', INTROSPECT)
    const fields = res.body.data.__type.fields as Array<{
      name: string; isDeprecated: boolean; deprecationReason: string | null
    }>
    const blogTitle = fields.find((f) => f.name === 'blogTitle')

    expect(blogTitle).toBeDefined()
    expect(blogTitle!.isDeprecated).toBe(true)
    expect(blogTitle!.deprecationReason).toBe("Renamed to 'title' in v3.")
  })

  it('marks v1’s retained column deprecated as removed', async () => {
    const res = await query('/graphql/v1', INTROSPECT)
    const fields = res.body.data.__type.fields as Array<{ name: string; deprecationReason: string | null }>

    expect(fields.find((f) => f.name === 'blogDesc')!.deprecationReason)
      .toBe('Removed in v3; column retained while this version is live.')
  })

  it('deprecates nothing on current', async () => {
    const res = await query('/graphql/v3', INTROSPECT)
    const fields = res.body.data.__type.fields as Array<{ name: string; isDeprecated: boolean }>
    expect(fields.every((f) => f.isDeprecated === false)).toBe(true)
  })
})

describe('versioned GraphQL — sorting per version', () => {
  it('accepts the label each version actually exposes and orders by the column', async () => {
    await db.execute(sql.raw(`
      INSERT INTO "${TABLE}" (slug, published, blog_title) VALUES ('aaa', true, 'Aaa')
    `))

    // v3 exposes label `title`, so `sortBy: title` resolves to column
    // blog_title. v1 exposes it as `blog_title`, so its enum has no `title`
    // value at all — offering one would reach SQL as ORDER BY "title".
    const v3 = await query('/graphql/v3', '{ gqlverBlogs(sortBy: title, sortOrder: ASC) { data { title } } }')
    expect(v3.body.errors).toBeUndefined()
    expect(v3.body.data.gqlverBlogs.data.map((r: { title: string }) => r.title)).toEqual(['Aaa', 'Hello'])

    const v1 = await query('/graphql/v1', '{ gqlverBlogs(sortBy: title) { data { blogTitle } } }')
    expect(v1.body.errors).toBeDefined()
    expect(v1.body.errors[0].message).toContain('title')
  })
})
