import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedParagraphType,
  ParsedRole,
} from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { signToken } from '../auth/jwt'
import { createLocalAdapter } from '../storage/adapters/local'

// Covers two admin write paths that had no route/persistence coverage:
//   1. `only_one` singletons, whose admin form saves with PUT (the parser
//      declares http_methods ['GET','PUT','PATCH'] for them).
//   2. One level of paragraph nesting (ADR core/0005) — a paragraph field on a
//      paragraph type, which has no column on its parent's table.

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

let AUTH_TOKEN = ''

function withAuth(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
      Cookie: `auth_token=${AUTH_TOKEN}`,
    },
  }
}

// ─── Tables (unique to this suite) ───────────────────────────────────────────

const SETTINGS_TABLE = 'api_int_wr_settings'
const PAGE_TABLE = 'api_int_wr_page'
const OUTER_PARA_TABLE = 'api_int_wr_outer'
const INNER_PARA_TABLE = 'api_int_wr_inner'

// ─── Schema fixtures ─────────────────────────────────────────────────────────

const CONTENT_SYSTEM_FIELDS = [
  { name: 'id', db_type: 'uuid' as const, primary_key: true, nullable: false },
  { name: 'slug', db_type: 'varchar' as const, nullable: false },
  { name: 'published', db_type: 'boolean' as const, default: 'false', nullable: false },
  { name: 'created_at', db_type: 'timestamp' as const, default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp' as const, default: 'now()', nullable: false },
]

const PARAGRAPH_SYSTEM_FIELDS = [
  { name: 'id', db_type: 'uuid' as const, primary_key: true, nullable: false },
  { name: 'parent_id', db_type: 'uuid' as const, nullable: false },
  { name: 'parent_type', db_type: 'varchar' as const, nullable: false },
  { name: 'parent_field', db_type: 'varchar' as const, nullable: false },
  { name: 'order', db_type: 'integer' as const, default: '0', nullable: false },
  { name: 'created_at', db_type: 'timestamp' as const, default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp' as const, default: 'now()', nullable: false },
]

// The innermost paragraph — scalar fields only, as the one-level cap requires.
const INNER_PARA: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--wr_inner',
  label: 'Inner',
  source_file: 't.yml',
  system_fields: PARAGRAPH_SYSTEM_FIELDS,
  fields: [
    {
      name: 'inner_text',
      label: 'Inner Text',
      field_type: 'text/plain',
      required: false,
      nullable: true,
      order: 0,
      validation: { required: false },
      db_column: { column_name: 'inner_text', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: INNER_PARA_TABLE },
}

// The outer paragraph, holding a nested paragraph field (no column of its own).
const OUTER_PARA: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--wr_outer',
  label: 'Outer',
  source_file: 't.yml',
  system_fields: PARAGRAPH_SYSTEM_FIELDS,
  fields: [
    {
      name: 'outer_title',
      label: 'Outer Title',
      field_type: 'text/plain',
      required: false,
      nullable: true,
      order: 0,
      validation: { required: false },
      db_column: { column_name: 'outer_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'outer_links',
      label: 'Outer Links',
      field_type: 'paragraph',
      required: false,
      nullable: true,
      order: 1,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--wr_inner', rel: 'one-to-many' },
    },
  ],
  db: { table_name: OUTER_PARA_TABLE },
}

const SETTINGS_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'wr-settings',
  label: 'Site Settings',
  source_file: 't.yml',
  only_one: true,
  default_base_path: 'wr-settings',
  system_fields: CONTENT_SYSTEM_FIELDS,
  fields: [
    {
      name: 'site_title',
      label: 'Site Title',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'site_title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  ui: { tabs: [] } as never,
  db: { table_name: SETTINGS_TABLE, junction_tables: [] },
  api: { default_base_path: 'wr-settings', http_methods: ['GET', 'PUT', 'PATCH'], item_path: '/api/wr-settings' },
}

const PAGE_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'wr-page',
  label: 'Page',
  source_file: 't.yml',
  only_one: false,
  default_base_path: 'wr-page',
  system_fields: CONTENT_SYSTEM_FIELDS,
  fields: [
    {
      name: 'page_title',
      label: 'Page Title',
      field_type: 'text/plain',
      required: false,
      nullable: true,
      order: 0,
      validation: { required: false },
      db_column: { column_name: 'page_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'page_blocks',
      label: 'Blocks',
      field_type: 'paragraph',
      required: false,
      nullable: true,
      order: 1,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--wr_outer', rel: 'one-to-many' },
    },
  ],
  ui: { tabs: [] } as never,
  db: { table_name: PAGE_TABLE, junction_tables: [] },
  api: {
    default_base_path: 'wr-page',
    http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    collection_path: '/api/wr-page',
    item_path: '/api/wr-page/:slug',
  },
}

const ALL_PERMISSIONS = [
  'content:read', 'content:create', 'content:edit', 'content:delete',
  'media:read', 'media:create', 'media:edit', 'media:delete',
  'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
  'users:read', 'users:create', 'users:edit', 'users:delete',
  'roles:read',
]

// buildRolesRegistry requires the full system-role set, not just admin.
const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0, permissions: ALL_PERMISSIONS },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor', label: 'Editor', is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer', label: 'Writer', is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer', label: 'Viewer', is_system: true, hierarchy_level: 4, permissions: [] },
] as unknown as ParsedRole[]

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { 'wr-settings': SETTINGS_TYPE, 'wr-page': PAGE_TYPE },
  paragraph_types: { 'paragraph--wr_outer': OUTER_PARA, 'paragraph--wr_inner': INNER_PARA },
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
} as unknown as SchemaRegistry

// ─── Lifecycle ───────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

function makeApp() {
  return createCmsApp({ storage: createLocalAdapter(), registry: REGISTRY, db }).app
}

beforeAll(async () => {
  process.env['AUTH_SECRET'] = 'admin-write-int-secret'
  await pgAdapter.connect()
  db = pgAdapter.getDb()

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL UNIQUE,
      label VARCHAR(255) NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT false,
      hierarchy_level INTEGER NOT NULL UNIQUE,
      permissions TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  await db.execute(sql.raw(`
    INSERT INTO roles (name, label, is_system, hierarchy_level, permissions)
    VALUES ('admin', 'Admin', true, 0, '{}') ON CONFLICT (name) DO NOTHING`))
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      role_id UUID NOT NULL REFERENCES roles(id),
      token_version INTEGER NOT NULL DEFAULT 0,
      must_change_password BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  const userResult = await db.execute(sql.raw(`
    INSERT INTO users (email, password_hash, role_id, token_version, must_change_password)
    SELECT 'admin-write-int@example.com', '', r.id, 0, false FROM roles r WHERE r.name = 'admin'
    ON CONFLICT (email) DO UPDATE SET token_version = 0 RETURNING id`))
  AUTH_TOKEN = await signToken(
    { user_id: (userResult.rows[0] as { id: string }).id, role: 'admin', token_version: 0 },
    3600
  )

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS base_paths (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      path VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  for (const p of ['wr-settings', 'wr-page']) {
    await db.execute(sql.raw(`
      INSERT INTO base_paths (name, path) VALUES ('${p}', '${p}') ON CONFLICT (path) DO NOTHING`))
  }

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${SETTINGS_TABLE}" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR(255) NOT NULL,
      base_path_id UUID,
      published BOOLEAN NOT NULL DEFAULT false,
      site_title VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${PAGE_TABLE}" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR(255) NOT NULL,
      base_path_id UUID,
      published BOOLEAN NOT NULL DEFAULT false,
      page_title VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
  for (const [t, col] of [[OUTER_PARA_TABLE, 'outer_title'], [INNER_PARA_TABLE, 'inner_text']] as const) {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "${t}" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id UUID NOT NULL,
        parent_type VARCHAR(255) NOT NULL,
        parent_field VARCHAR(255) NOT NULL,
        "order" INTEGER NOT NULL DEFAULT 0,
        ${col} VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`))
  }
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(50) NOT NULL,
      url TEXT NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      alt TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      width INTEGER, height INTEGER, duration INTEGER,
      reference_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
})

afterAll(async () => {
  for (const t of [SETTINGS_TABLE, PAGE_TABLE, OUTER_PARA_TABLE, INNER_PARA_TABLE]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}"`))
  }
})

beforeEach(async () => {
  for (const t of [SETTINGS_TABLE, PAGE_TABLE, OUTER_PARA_TABLE, INNER_PARA_TABLE]) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`))
  }
})

// ─── Singleton (only_one) writes ─────────────────────────────────────────────

describe('singleton content type — PUT upsert', () => {
  it('creates the row on first PUT', async () => {
    const app = makeApp()
    const res = await app.request(
      '/admin/api/content/wr-settings',
      withAuth({ method: 'PUT', body: JSON.stringify({ site_title: 'First', published: false }) })
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.data['site_title']).toBe('First')
  })

  it('updates the same row on a second PUT rather than creating another', async () => {
    const app = makeApp()
    await app.request(
      '/admin/api/content/wr-settings',
      withAuth({ method: 'PUT', body: JSON.stringify({ site_title: 'First' }) })
    )
    const res = await app.request(
      '/admin/api/content/wr-settings',
      withAuth({ method: 'PUT', body: JSON.stringify({ site_title: 'Second' }) })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data['site_title']).toBe('Second')

    const rows = await db.execute(sql.raw(`SELECT id FROM "${SETTINGS_TABLE}"`))
    expect(rows.rows.length).toBe(1)
  })

  it('rejects an unauthenticated PUT', async () => {
    const app = makeApp()
    const res = await app.request('/admin/api/content/wr-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_title: 'Nope' }),
    })
    expect(res.status).toBe(401)
  })

  it('does not register PUT for non-singleton collections', async () => {
    const app = makeApp()
    const res = await app.request(
      '/admin/api/content/wr-page',
      withAuth({ method: 'PUT', body: JSON.stringify({ page_title: 'x' }) })
    )
    expect(res.status).toBe(404)
  })
})

// ─── Nested paragraphs (ADR core/0005: exactly one level) ────────────────────

describe('nested paragraphs — persist and read back', () => {
  async function createPageWithNesting() {
    const app = makeApp()
    const res = await app.request(
      '/admin/api/content/wr-page',
      withAuth({
        method: 'POST',
        body: JSON.stringify({
          slug: 'nested-page',
          page_title: 'Nested',
          page_blocks: [
            { outer_title: 'Block A', outer_links: [{ inner_text: 'link a1' }, { inner_text: 'link a2' }] },
            { outer_title: 'Block B', outer_links: [] },
          ],
        }),
      })
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: Record<string, unknown> }
    return { app, id: body.data['id'] as string }
  }

  it('persists nested paragraph rows against their parent paragraph row', async () => {
    await createPageWithNesting()

    const outer = await db.execute(
      sql.raw(`SELECT id, outer_title FROM "${OUTER_PARA_TABLE}" ORDER BY "order" ASC`)
    )
    expect(outer.rows.length).toBe(2)

    const inner = await db.execute(
      sql.raw(`SELECT parent_id, parent_field, inner_text FROM "${INNER_PARA_TABLE}" ORDER BY "order" ASC`)
    )
    expect(inner.rows.length).toBe(2)
    const blockAId = (outer.rows[0] as { id: string }).id
    for (const row of inner.rows as Array<Record<string, unknown>>) {
      expect(row['parent_id']).toBe(blockAId)
      expect(row['parent_field']).toBe('outer_links')
    }
    expect((inner.rows as Array<Record<string, unknown>>).map((r) => r['inner_text'])).toEqual([
      'link a1',
      'link a2',
    ])
  })

  it('returns nested items from the admin edit read', async () => {
    const { app, id } = await createPageWithNesting()

    const res = await app.request(`/admin/api/content/wr-page/${id}`, withAuth())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    const blocks = body.data['page_blocks'] as Array<Record<string, unknown>>
    expect(blocks.length).toBe(2)
    expect(blocks[0]!['outer_title']).toBe('Block A')

    const links = blocks[0]!['outer_links'] as Array<Record<string, unknown>>
    expect(links.map((l) => l['inner_text'])).toEqual(['link a1', 'link a2'])
    expect((blocks[1]!['outer_links'] as unknown[]).length).toBe(0)
  })

  it('replaces nested rows on update without orphaning the old ones', async () => {
    const { app, id } = await createPageWithNesting()

    const res = await app.request(
      `/admin/api/content/wr-page/${id}`,
      withAuth({
        method: 'PATCH',
        body: JSON.stringify({
          page_blocks: [{ outer_title: 'Block A', outer_links: [{ inner_text: 'replaced' }] }],
        }),
      })
    )
    expect(res.status).toBe(200)

    const inner = await db.execute(sql.raw(`SELECT inner_text FROM "${INNER_PARA_TABLE}"`))
    expect((inner.rows as Array<Record<string, unknown>>).map((r) => r['inner_text'])).toEqual([
      'replaced',
    ])
  })

  it('deletes nested rows when the owning content item is deleted', async () => {
    const { app, id } = await createPageWithNesting()

    const res = await app.request(`/admin/api/content/wr-page/${id}`, withAuth({ method: 'DELETE' }))
    expect(res.status).toBe(200)

    const outer = await db.execute(sql.raw(`SELECT id FROM "${OUTER_PARA_TABLE}"`))
    const inner = await db.execute(sql.raw(`SELECT id FROM "${INNER_PARA_TABLE}"`))
    expect(outer.rows.length).toBe(0)
    expect(inner.rows.length).toBe(0)
  })
})
