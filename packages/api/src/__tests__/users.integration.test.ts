import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedRole } from '@bobbykim/manguito-cms-core'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ID    = 'a0200000-0000-0000-0000-000000000001'
const EDITOR_ID   = 'a0200000-0000-0000-0000-000000000002'
const ADMIN_EMAIL  = 'admin@users-int.test'
const EDITOR_EMAIL = 'editor@users-int.test'
const ADMIN_PW     = 'users-admin-pw'
const EDITOR_PW    = 'users-editor-pw'

// ─── Registry (admin needs full user permissions for requirePermission) ────────

const SYSTEM_ROLES: ParsedRole[] = [
  {
    name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0,
    permissions: ['users:read', 'users:create', 'users:edit', 'users:delete',
                  'content:read', 'content:create', 'content:edit', 'content:delete'],
  },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: ['users:read'] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: {},
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── DB lifecycle ─────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance
let adminHash: string
let editorHash: string

beforeAll(async () => {
  process.env['AUTH_SECRET'] = 'users-int-test-secret'

  adminHash  = await hashPassword(ADMIN_PW)
  editorHash = await hashPassword(EDITOR_PW)

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
        SELECT ${EDITOR_ID}, ${EDITOR_EMAIL}, ${editorHash}, r.id, 0, false
        FROM roles r WHERE r.name = 'editor'`,
  )
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const { app } = createCmsApp({ storage: createLocalAdapter(), registry: TEST_REGISTRY, db })
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

async function authedRequest(
  app: App,
  path: string,
  authToken: string,
  init: RequestInit = {},
) {
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: `auth_token=${authToken}`,
    },
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('User management — integration', () => {
  it('POST /admin/api/users → creates user, returns temporary_password once', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await authedRequest(app, '/admin/api/users', authToken, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'newuser@users-int.test', role: 'editor' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as {
      ok: boolean
      data: {
        id: string
        email: string
        role: string
        temporary_password: string
        must_change_password: boolean
      }
    }
    expect(body.ok).toBe(true)
    expect(body.data.email).toBe('newuser@users-int.test')
    expect(body.data.role).toBe('editor')
    expect(typeof body.data.temporary_password).toBe('string')
    expect(body.data.temporary_password.length).toBeGreaterThan(0)
    expect(body.data.must_change_password).toBe(true)
  })

  it('GET /admin/api/users/:id → UserResponse does not include password_hash or token_version', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await authedRequest(app, `/admin/api/users/${EDITOR_ID}`, authToken)

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.data['id']).toBe(EDITOR_ID)
    expect(body.data['email']).toBe(EDITOR_EMAIL)
    expect(body.data['role']).toBe('editor')
    expect('password_hash'   in body.data).toBe(false)
    expect('token_version'   in body.data).toBe(false)
    expect('temporary_password' in body.data).toBe(false)
  })

  it('POST /admin/api/users/change-password → clears must_change_password, new password accepted', async () => {
    const app = makeApp()

    // Force must_change_password = true so we can verify it's cleared
    await db.execute(
      sql`UPDATE users SET must_change_password = true WHERE id = ${ADMIN_ID}`,
    )

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const changeRes = await authedRequest(app, '/admin/api/users/change-password', authToken, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current_password: ADMIN_PW, new_password: 'brand-new-pw' }),
    })

    expect(changeRes.status).toBe(200)
    expect((await changeRes.json() as { ok: boolean }).ok).toBe(true)

    // Verify must_change_password was cleared in DB
    const row = await db.execute(
      sql`SELECT must_change_password FROM users WHERE id = ${ADMIN_ID}`,
    )
    expect((row.rows[0] as { must_change_password: boolean }).must_change_password).toBe(false)

    // Login with the new password should succeed
    const newLoginRes = await login(app, ADMIN_EMAIL, 'brand-new-pw')
    expect(newLoginRes.status).toBe(200)
  })

  it('POST /admin/api/users/change-password wrong current password → 401 INVALID_CREDENTIALS', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')!

    const res = await authedRequest(app, '/admin/api/users/change-password', authToken, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current_password: 'wrong-old-pw', new_password: 'new-pw' }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('role change increments token_version → existing token rejected as TOKEN_INVALID', async () => {
    const app = makeApp()

    // Editor logs in — captures their token before the role change
    const editorLoginRes = await login(app, EDITOR_EMAIL, EDITOR_PW)
    const editorToken = extractCookie(editorLoginRes, 'auth_token')!

    // Admin logs in to perform the role change
    const adminLoginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const adminToken = extractCookie(adminLoginRes, 'auth_token')!

    // Admin patches editor's role → triggers token_version increment
    const patchRes = await authedRequest(app, `/admin/api/users/${EDITOR_ID}`, adminToken, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'writer' }),
    })
    expect(patchRes.status).toBe(200)

    // The editor's old token is now stale (token_version mismatch)
    const staleRes = await authedRequest(app, '/admin/api/users', editorToken)
    expect(staleRes.status).toBe(401)
    const body = await staleRes.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_INVALID')
  })
})
