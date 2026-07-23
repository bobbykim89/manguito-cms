import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType, ParsedTaxonomyType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test')

const TABLE = 'api_int_gql_post'

const POST: ParsedContentType = {
  schema_type: 'content-type', name: 'content--gqlpost', label: 'Gql Post',
  source_file: 't.yml', only_one: false, default_base_path: 'gqlpost',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    { name: 'blog_title', label: 'Title', field_type: 'text/plain', required: true, nullable: false,
      order: 0, validation: { required: true },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' } },
  ],
  ui: { tabs: [] },
  db: { table_name: TABLE, junction_tables: [] },
  api: { default_base_path: 'gqlpost', http_methods: ['GET'], item_path: '/gqlpost/:slug' },
}

// buildRolesRegistry (invoked by createCmsApp) requires all five system roles
// present with distinct hierarchy levels — an empty/missing roles array makes
// createCmsApp throw at startup, so this mirrors the fixture used by the other
// integration suites (see public.integration.test.ts).
const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const registry: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { 'content--gqlpost': POST },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance
let app: { fetch: (r: Request) => Response | Promise<Response> }

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
  await db.execute(sql.raw(`CREATE TABLE "${TABLE}" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug varchar NOT NULL, published boolean NOT NULL DEFAULT false, blog_title varchar NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`))
  await db.execute(sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title) VALUES ('published-one', true, 'Published'), ('draft-one', false, 'Draft')`))

  const built = createCmsApp({
    registry, db, storage: createLocalAdapter(),
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
  })
  app = built.app
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
  await pgAdapter.disconnect()
})

async function gql(query: string) {
  const res = await app.fetch(new Request('http://local/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  }))
  return res.json() as Promise<{ data?: Record<string, never>; errors?: unknown }>
}

describe('graphql integration', () => {
  it('returns only published items in a list query', async () => {
    const body = await gql('{ gqlposts { data { blogTitle } meta { total } } }')
    expect(body.errors).toBeUndefined()
    const gqlposts = (body.data as unknown as { gqlposts: { data: { blogTitle: string }[]; meta: { total: number } } }).gqlposts
    const titles = gqlposts.data.map((d) => d.blogTitle)
    expect(titles).toEqual(['Published'])
    expect(gqlposts.meta.total).toBe(1)
  })

  it('never returns a draft by slug', async () => {
    const body = await gql('{ gqlpost(slug: "draft-one") { blogTitle } }')
    expect(body.errors).toBeUndefined()
    const gqlpost = (body.data as unknown as { gqlpost: unknown }).gqlpost
    expect(gqlpost).toBeNull()
  })
})

// A GraphQL type-name collision (two schemas whose machine-name segments both
// map to the same PascalCase GraphQL type name) makes `buildGraphQLSchema`
// throw synchronously. That throw happens inside the `.then()` callback of the
// dynamic `import('./graphql/handler.js')` in app.ts, so it rejects the shared
// `ready` promise. Without a `.catch` there, that's an unhandled rejection —
// Node terminates the whole process at startup, taking every REST route down
// with it, independent of whether any client ever hits /graphql. This suite
// proves the failure is instead contained: the process survives and /graphql
// answers with a 500 envelope.
describe('graphql schema-init failure', () => {
  const DUP_CONTENT: ParsedContentType = {
    ...POST,
    name: 'content--dup',
    db: { table_name: TABLE, junction_tables: [] },
  }
  const DUP_TAXONOMY: ParsedTaxonomyType = {
    schema_type: 'taxonomy-type',
    name: 'taxonomy--dup',
    label: 'Dup',
    source_file: 't.yml',
    system_fields: [
      { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
      { name: 'slug', db_type: 'varchar', nullable: false },
    ],
    fields: [],
    db: { table_name: TABLE },
    api: { collection_path: '/dup', item_path: '/dup/:slug' },
  }

  const collidingRegistry: SchemaRegistry = {
    routes: { base_paths: [] },
    roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
    schemas: {},
    content_types: { 'content--dup': DUP_CONTENT },
    paragraph_types: {},
    // Both 'content--dup' and 'taxonomy--dup' produce the GraphQL type name
    // 'Dup' — this is the collision buildGraphQLSchema rejects on.
    taxonomy_types: { 'taxonomy--dup': DUP_TAXONOMY },
    enum_types: {},
    all_schemas: [],
  }

  it('returns 500 instead of crashing the process when schema build throws', async () => {
    const built = createCmsApp({
      registry: collidingRegistry,
      db,
      storage: createLocalAdapter(),
      graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
    })

    const res = await built.app.fetch(
      new Request('http://local/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      })
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('GRAPHQL_INIT_FAILED')
  })
})
