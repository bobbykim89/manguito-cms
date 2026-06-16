import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedRole, ParsedContentType } from '@bobbykim/manguito-cms-core'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { createAPIAdapter } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ID    = 'a0300000-0000-0000-0000-000000000001'
const MANAGER_ID  = 'a0300000-0000-0000-0000-000000000002'
const ADMIN_EMAIL   = 'admin@config-int.test'
const MANAGER_EMAIL = 'manager@config-int.test'
const ADMIN_PW      = 'config-admin-pw'
const MANAGER_PW    = 'config-manager-pw'
const CMS_NAME      = 'Test CMS'

// ─── Registry ─────────────────────────────────────────────────────────────────

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const ARTICLE_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'article',
  label: 'Article',
  source_file: 'article.yml',
  only_one: false,
  default_base_path: 'articles',
  system_fields: [
    { name: 'id',         db_type: 'uuid',      primary_key: true, nullable: false },
    { name: 'slug',       db_type: 'varchar',   nullable: false },
    { name: 'published',  db_type: 'boolean',   default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [
    {
      name: 'title', label: 'Title', field_type: 'text/plain', required: true,
      nullable: false, order: 0, validation: { required: true },
      db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: 'content_article', junction_tables: [] },
  api: {
    default_base_path: 'articles',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/admin/api/articles/:id',
  },
}

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { article: ARTICLE_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── DB lifecycle ─────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance
let adminHash: string
let managerHash: string

beforeAll(async () => {
  process.env['AUTH_SECRET'] = 'config-int-test-secret'

  adminHash   = await hashPassword(ADMIN_PW)
  managerHash = await hashPassword(MANAGER_PW)

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
    CREATE TABLE IF NOT EXISTS users (
      id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      email                VARCHAR(255) NOT NULL UNIQUE,
      password_hash        VARCHAR(255) NOT NULL,
      role_id              UUID         NOT NULL REFERENCES roles(id),
      token_version        INTEGER      NOT NULL DEFAULT 0,
      must_change_password BOOLEAN      NOT NULL DEFAULT false,
      created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `))
  await db.execute(sql.raw(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`,
  ))

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS media (
      id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      url             VARCHAR(2048) NOT NULL,
      mime_type       VARCHAR(255)  NOT NULL,
      alt             VARCHAR(255),
      file_size       INTEGER       NOT NULL,
      width           INTEGER,
      height          INTEGER,
      duration        INTEGER,
      reference_count INTEGER       NOT NULL DEFAULT 0,
      created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `))

  await db.execute(sql.raw('TRUNCATE TABLE roles CASCADE'))
  for (const role of SYSTEM_ROLES) {
    await db.execute(
      sql`INSERT INTO roles (name, label, is_system, hierarchy_level, permissions)
          VALUES (${role.name}, ${role.label}, ${role.is_system}, ${role.hierarchy_level}, '{}')`,
    )
  }
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw('TRUNCATE TABLE users'))
  await pgAdapter.disconnect()
  delete process.env['AUTH_SECRET']
})

beforeEach(async () => {
  await db.execute(sql.raw('TRUNCATE TABLE users'))

  await db.execute(
    sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
        SELECT ${ADMIN_ID}, ${ADMIN_EMAIL}, ${adminHash}, r.id, 0, false
        FROM roles r WHERE r.name = 'admin'`,
  )

  await db.execute(
    sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
        SELECT ${MANAGER_ID}, ${MANAGER_EMAIL}, ${managerHash}, r.id, 0, false
        FROM roles r WHERE r.name = 'manager'`,
  )
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const { app } = createAPIAdapter({
    name: CMS_NAME,
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
  })
  return app
}

type App = ReturnType<typeof makeApp>

async function login(app: App, email: string, password: string) {
  return app.request('/admin/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ email, password }),
  })
}

function extractCookie(res: Response, name: string): string | undefined {
  for (const h of res.headers.getSetCookie()) {
    const [nameValue] = h.split(';')
    const eqIdx = (nameValue ?? '').indexOf('=')
    if (eqIdx === -1) continue
    if ((nameValue ?? '').slice(0, eqIdx).trim() === name) {
      return (nameValue ?? '').slice(eqIdx + 1).trim()
    }
  }
  return undefined
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Config and schema endpoints — integration', () => {
  it('GET /admin/api/config without token → 401', async () => {
    const app = makeApp()

    const res = await app.request('/admin/api/config')

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('GET /admin/api/config → returns cms_name and version', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await app.request('/admin/api/config', {
      headers: { cookie: `auth_token=${authToken}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      data: { cms_name: string; version: string; roles: Array<{ name: string }> }
    }
    expect(body.ok).toBe(true)
    expect(body.data.cms_name).toBe(CMS_NAME)
    expect(typeof body.data.version).toBe('string')
    expect(Array.isArray(body.data.roles)).toBe(true)
  })

  it('admin role never in roles list regardless of who is asking', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await app.request('/admin/api/config', {
      headers: { cookie: `auth_token=${authToken}` },
    })

    const body = await res.json() as {
      data: { roles: Array<{ name: string; hierarchy_level: number }> }
    }
    const roleNames = body.data.roles.map((r) => r.name)
    expect(roleNames).not.toContain('admin')
  })

  it('acting user own role and higher-privilege roles not in list', async () => {
    const app = makeApp()

    // Manager (level 1) → list should only include levels > 1: editor, writer, viewer
    const loginRes = await login(app, MANAGER_EMAIL, MANAGER_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await app.request('/admin/api/config', {
      headers: { cookie: `auth_token=${authToken}` },
    })

    const body = await res.json() as {
      data: { roles: Array<{ name: string; hierarchy_level: number }> }
    }
    const roleNames = body.data.roles.map((r) => r.name)

    // manager's own role must not appear
    expect(roleNames).not.toContain('manager')
    // roles above manager (lower hierarchy number) must not appear
    expect(roleNames).not.toContain('admin')
    // roles below manager must appear
    expect(roleNames).toContain('editor')
    expect(roleNames).toContain('writer')
    expect(roleNames).toContain('viewer')
  })

  it('config response does not include storage, db, or auth configuration', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await app.request('/admin/api/config', {
      headers: { cookie: `auth_token=${authToken}` },
    })

    const body = await res.json() as { data: Record<string, unknown> }
    const dataKeys = Object.keys(body.data)

    // Exactly these three keys — no storage/db/auth fields
    expect(dataKeys).toEqual(expect.arrayContaining(['cms_name', 'version', 'roles']))
    expect(dataKeys).not.toContain('storage')
    expect(dataKeys).not.toContain('db')
    expect(dataKeys).not.toContain('auth')
    expect(dataKeys).not.toContain('AUTH_SECRET')
    expect(dataKeys).not.toContain('server')
  })

  it('GET /admin/api/schema → returns full schema definitions', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await app.request('/admin/api/schema', {
      headers: { cookie: `auth_token=${authToken}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      data: {
        content_types: Array<{ name: string; label: string; only_one: boolean; fields: unknown[] }>
        taxonomy_types: unknown[]
        paragraph_types: unknown[]
        enum_types: unknown[]
      }
    }
    expect(body.ok).toBe(true)

    // content_types reflects the TEST_REGISTRY (one article type)
    expect(body.data.content_types).toHaveLength(1)
    const articleType = body.data.content_types[0]!
    expect(articleType.name).toBe('article')
    expect(articleType.label).toBe('Article')
    expect(articleType.only_one).toBe(false)
    expect(articleType.fields).toHaveLength(1)

    // other type arrays are empty (no types in registry)
    expect(body.data.taxonomy_types).toHaveLength(0)
    expect(body.data.paragraph_types).toHaveLength(0)
    expect(body.data.enum_types).toHaveLength(0)
  })
})
