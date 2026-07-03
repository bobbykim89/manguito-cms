import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import { signToken } from '../auth/jwt'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Auth state (populated in beforeAll) ─────────────────────────────────────

let TEST_AUTH_TOKEN = ''
let VIEWER_AUTH_TOKEN = ''

function withAuth(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Cookie: `auth_token=${TEST_AUTH_TOKEN}`,
    },
  }
}

// A viewer holds no media permissions in TEST_REGISTRY — used to prove the
// admin media routes actually enforce media:* (not the no-op shim).
function withViewerAuth(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Cookie: `auth_token=${VIEWER_AUTH_TOKEN}`,
    },
  }
}

// ─── Table names (unique to this suite) ──────────────────────────────────────

const BLOG_TABLE = 'api_int_adm_blog'
const BASE_PATH = 'adm-test-blog'

// ─── Schema fixtures ──────────────────────────────────────────────────────────

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'adm-test-blog',
  label: 'Admin Test Blog',
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
  ],
  ui: { tabs: [] },
  db: { table_name: BLOG_TABLE, junction_tables: [] },
  api: {
    default_base_path: BASE_PATH,
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: `/admin/api/content/${BASE_PATH}/:id`,
  },
}

const ALL_PERMISSIONS: ParsedRole['permissions'] = [
  'content:read', 'content:create', 'content:edit', 'content:delete',
  'media:read', 'media:create', 'media:edit', 'media:delete',
  'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
  'users:read', 'users:create', 'users:edit', 'users:delete',
  'roles:read', 'roles:create', 'roles:edit', 'roles:delete',
]

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: ALL_PERMISSIONS },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { 'adm-test-blog': BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── DB lifecycle ─────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  process.env['AUTH_SECRET'] = 'admin-int-test-secret'
  await pgAdapter.connect()
  db = pgAdapter.getDb()

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS roles (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255) NOT NULL UNIQUE,
      label           VARCHAR(255) NOT NULL,
      is_system       BOOLEAN      NOT NULL DEFAULT false,
      hierarchy_level INTEGER      NOT NULL UNIQUE,
      permissions     TEXT[]       NOT NULL DEFAULT '{}',
      created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `))

  await db.execute(sql.raw(`
    INSERT INTO roles (name, label, is_system, hierarchy_level, permissions)
    VALUES ('admin', 'Admin', true, 0, '{}')
    ON CONFLICT (name) DO NOTHING
  `))

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      email                VARCHAR(255) NOT NULL UNIQUE,
      password_hash        VARCHAR(255) NOT NULL DEFAULT '',
      role_id              UUID         NOT NULL REFERENCES roles(id),
      token_version        INTEGER      NOT NULL DEFAULT 0,
      must_change_password BOOLEAN      NOT NULL DEFAULT false,
      created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `))

  const userResult = await db.execute(sql.raw(`
    INSERT INTO users (email, password_hash, role_id, token_version, must_change_password)
    SELECT 'admin-int-test@example.com', '', r.id, 0, false
    FROM roles r WHERE r.name = 'admin'
    ON CONFLICT (email) DO UPDATE SET token_version = 0
    RETURNING id
  `))
  const userId = (userResult.rows[0] as { id: string }).id
  TEST_AUTH_TOKEN = await signToken({ user_id: userId, role: 'admin', token_version: 0 }, 3600)

  // A viewer with no permissions — used to assert media routes enforce media:*.
  await db.execute(sql.raw(`
    INSERT INTO roles (name, label, is_system, hierarchy_level, permissions)
    VALUES ('viewer', 'Viewer', true, 4, '{}')
    ON CONFLICT (name) DO NOTHING
  `))
  const viewerResult = await db.execute(sql.raw(`
    INSERT INTO users (email, password_hash, role_id, token_version, must_change_password)
    SELECT 'viewer-int-test@example.com', '', r.id, 0, false
    FROM roles r WHERE r.name = 'viewer'
    ON CONFLICT (email) DO UPDATE SET token_version = 0
    RETURNING id
  `))
  const viewerId = (viewerResult.rows[0] as { id: string }).id
  VIEWER_AUTH_TOKEN = await signToken({ user_id: viewerId, role: 'viewer', token_version: 0 }, 3600)

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${BLOG_TABLE}" (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        VARCHAR         NOT NULL UNIQUE,
      published   BOOLEAN         NOT NULL DEFAULT false,
      blog_title  VARCHAR,
      created_at  TIMESTAMP       NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP       NOT NULL DEFAULT NOW()
    )
  `))

  // System media table used by mediaRepo — created once, shared across suites.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS media (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type            VARCHAR(50)      NOT NULL DEFAULT 'image',
      url             VARCHAR(2048)    NOT NULL,
      mime_type       VARCHAR(255)     NOT NULL,
      alt             VARCHAR(255),
      file_size       INTEGER          NOT NULL,
      width           INTEGER,
      height          INTEGER,
      duration        INTEGER,
      reference_count INTEGER          NOT NULL DEFAULT 0,
      created_at      TIMESTAMP        NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP        NOT NULL DEFAULT NOW()
    )
  `))
  await db.execute(sql.raw(
    `ALTER TABLE media ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'image'`
  ))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${BLOG_TABLE}" CASCADE`))
  await db.execute(sql.raw(`DELETE FROM users WHERE email = 'admin-int-test@example.com'`))
  delete process.env['AUTH_SECRET']
  // Leave the media table — other test files may share it; it will be dropped by its own suite.
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${BLOG_TABLE}" RESTART IDENTITY CASCADE`))
  await db.execute(sql.raw(`TRUNCATE TABLE media RESTART IDENTITY CASCADE`))
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
  })
  return app
}

function makeAppWithMaxFileSize(max: number) {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
    media: { max_file_size: max },
  })
  return app
}

type MediaRow = {
  id: string
  url: string
  mime_type: string
  file_size: number
  reference_count: number
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('admin content routes — integration', () => {
  it('GET /admin/api/{type} returns all items including drafts', async () => {
    const app = makeApp()

    await db.execute(sql.raw(`
      INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title) VALUES
        ('pub-1',   true,  'Published One'),
        ('pub-2',   true,  'Published Two'),
        ('draft-1', false, 'Draft One')
    `))

    const res = await app.request(`/admin/api/content/${BASE_PATH}`, withAuth())
    expect(res.status).toBe(200)

    const body = await res.json() as {
      ok: boolean
      data: unknown[]
      meta: { total: number }
    }
    expect(body.ok).toBe(true)
    // Admin list returns all items regardless of published state
    expect(body.meta.total).toBe(3)
    expect(body.data).toHaveLength(3)
  })

  it('PATCH /admin/api/{type}/:id with published: true validates required fields', async () => {
    const app = makeApp()

    // Insert a draft with blog_title = NULL (simulates empty draft)
    const result = await db.execute(sql.raw(`
      INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title)
      VALUES ('draft-for-publish', false, NULL)
      RETURNING id
    `))
    const id = (result.rows[0] as { id: string }).id

    const res = await app.request(`/admin/api/content/${BASE_PATH}/${id}`, withAuth({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: true }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as {
      ok: boolean
      error: { code: string; details: { field: string; message: string }[] }
    }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('PUBLISH_VALIDATION_ERROR')
    expect(Array.isArray(body.error.details)).toBe(true)
    expect(body.error.details.length).toBeGreaterThan(0)
    expect(body.error.details[0]!.field).toBe('blog_title')
  })

  it('PATCH /admin/api/{type}/:id with published: false succeeds with empty required fields', async () => {
    const app = makeApp()

    // Insert a published item then try to unpublish with empty required field
    const result = await db.execute(sql.raw(`
      INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title)
      VALUES ('currently-published', true, 'Some Title')
      RETURNING id
    `))
    const id = (result.rows[0] as { id: string }).id

    const res = await app.request(`/admin/api/content/${BASE_PATH}/${id}`, withAuth({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: false, blog_title: '' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { published: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data.published).toBe(false)
  })
})

describe('admin media routes — integration', () => {
  it('POST /admin/api/media/image writes DB row and returns media object', async () => {
    const app = makeApp()

    const file = new File([Buffer.from('fake png content')], 'test.png', {
      type: 'image/png',
    })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/admin/api/media/image', withAuth({
      method: 'POST',
      body: formData,
    }))

    expect(res.status).toBe(201)
    const body = await res.json() as {
      ok: boolean
      data: MediaRow
    }
    expect(body.ok).toBe(true)
    expect(typeof body.data.id).toBe('string')
    expect(body.data.mime_type).toBe('image/png')
    expect(body.data.reference_count).toBe(0)
    expect(body.data.url).toContain('uploads/')

    // Verify the row was persisted in the DB
    const dbResult = await db.execute(sql`SELECT * FROM media WHERE id = ${body.data.id}`)
    expect(dbResult.rows).toHaveLength(1)
  })

  it('DELETE /admin/api/media/:id removes from storage and DB', async () => {
    const app = makeApp()

    // Insert a media row directly — local adapter ignores missing files on delete
    const insertResult = await db.execute(sql.raw(`
      INSERT INTO media (type, url, mime_type, file_size, reference_count)
      VALUES ('image', 'http://localhost:3000/uploads/image/to-delete.png', 'image/png', 1024, 0)
      RETURNING id
    `))
    const id = (insertResult.rows[0] as { id: string }).id

    const res = await app.request(`/admin/api/media/${id}`, withAuth({ method: 'DELETE' }))
    expect(res.status).toBe(200)

    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify the DB row is gone
    const dbResult = await db.execute(sql`SELECT * FROM media WHERE id = ${id}`)
    expect(dbResult.rows).toHaveLength(0)
  })

  it('DELETE /admin/api/media/:id returns 409 MEDIA_IN_USE when reference_count > 0', async () => {
    const app = makeApp()

    const insertResult = await db.execute(sql.raw(`
      INSERT INTO media (type, url, mime_type, file_size, reference_count)
      VALUES ('image', 'http://localhost:3000/uploads/image/in-use.png', 'image/png', 512, 1)
      RETURNING id
    `))
    const id = (insertResult.rows[0] as { id: string }).id

    const res = await app.request(`/admin/api/media/${id}`, withAuth({ method: 'DELETE' }))
    expect(res.status).toBe(409)

    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('MEDIA_IN_USE')
  })

  // ─── Permission enforcement — a viewer holds no media:* permissions ──────────
  // The permission middleware runs before the handler, so these 403 before any
  // body/existence check.

  it('POST /admin/api/media/image as viewer → 403 INSUFFICIENT_PERMISSION (media:create)', async () => {
    const app = makeApp()
    const res = await app.request('/admin/api/media/image', withViewerAuth({ method: 'POST' }))
    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })

  it('PATCH /admin/api/media/:id as viewer → 403 INSUFFICIENT_PERMISSION (media:edit)', async () => {
    const app = makeApp()
    const res = await app.request(
      '/admin/api/media/00000000-0000-0000-0000-000000000000',
      withViewerAuth({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    )
    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })

  it('DELETE /admin/api/media/:id as viewer → 403 INSUFFICIENT_PERMISSION (media:delete)', async () => {
    const app = makeApp()
    const res = await app.request(
      '/admin/api/media/00000000-0000-0000-0000-000000000000',
      withViewerAuth({ method: 'DELETE' }),
    )
    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })

  it('POST /admin/api/media/confirm/:id as viewer → 403 (upload path also enforces media:create)', async () => {
    const app = makeApp()
    const res = await app.request(
      '/admin/api/media/confirm/00000000-0000-0000-0000-000000000000',
      withViewerAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    )
    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })

  it('POST /admin/api/media/image over max_file_size → 413 FILE_TOO_LARGE', async () => {
    const app = makeAppWithMaxFileSize(100) // 100-byte limit
    const form = new FormData()
    form.append('file', new File(['x'.repeat(500)], 'big.png', { type: 'image/png' }))
    form.append('alt', 'big image')
    const res = await app.request('/admin/api/media/image', withAuth({ method: 'POST', body: form }))
    expect(res.status).toBe(413)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.error.code).toBe('FILE_TOO_LARGE')
  })
})

describe('admin OpenAPI — integration', () => {
  it('GET /admin/api/openapi.json requires auth — returns 401 without token', async () => {
    const app = makeApp()
    const res = await app.request('/admin/api/openapi.json')
    expect(res.status).toBe(401)
  })

  it('GET /admin/api/openapi.json returns spec when authenticated', async () => {
    const app = makeApp()
    const res = await app.request('/admin/api/openapi.json', withAuth())
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(typeof body['openapi']).toBe('string')
  })
})
