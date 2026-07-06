import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedRole } from '@bobbykim/manguito-cms-core'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { signToken } from '../auth/jwt'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ID   = 'a0100000-0000-0000-0000-000000000001'
const ADMIN_EMAIL = 'admin@auth-int.test'
const ADMIN_PW    = 'auth-integration-pw'

// ─── Registry ─────────────────────────────────────────────────────────────────

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
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

beforeAll(async () => {
  process.env['AUTH_SECRET'] = 'auth-int-test-secret'

  adminHash = await hashPassword(ADMIN_PW)

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
  // Add Phase 6 column if the table pre-dates it (idempotent)
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

  // Full reset — truncating roles cascades to users (FK dependency)
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
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const { app } = createCmsApp({ storage: createLocalAdapter(), registry: TEST_REGISTRY, db })
  return app
}

type App = ReturnType<typeof makeApp>

async function login(app: App, email: string, password: string, ip = '127.0.0.1') {
  return app.request('/admin/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  })
}

function extractCookie(res: Response, name: string): string | undefined {
  const headers = res.headers.getSetCookie()
  for (const h of headers) {
    const [nameValue] = h.split(';')
    const eqIdx = (nameValue ?? '').indexOf('=')
    if (eqIdx === -1) continue
    const n = (nameValue ?? '').slice(0, eqIdx).trim()
    const v = (nameValue ?? '').slice(eqIdx + 1).trim()
    if (n === name) return v
  }
  return undefined
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth — integration', () => {
  it('GET /admin/api/users without token → 401 UNAUTHORIZED', async () => {
    const app = makeApp()

    const res = await app.request('/admin/api/users')

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('POST /admin/api/auth/login correct credentials → sets cookies, returns { id, email, role }', async () => {
    const app = makeApp()

    const res = await login(app, ADMIN_EMAIL, ADMIN_PW)

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { id: string; email: string; role: string } }
    expect(body.ok).toBe(true)
    expect(body.data.email).toBe(ADMIN_EMAIL)
    expect(body.data.role).toBe('admin')
    expect(typeof body.data.id).toBe('string')

    expect(extractCookie(res, 'auth_token')).toBeTruthy()
    expect(extractCookie(res, 'refresh_token')).toBeTruthy()
  })

  it('POST /admin/api/auth/login wrong password → 401 INVALID_CREDENTIALS', async () => {
    const app = makeApp()

    const res = await login(app, ADMIN_EMAIL, 'wrong-password')

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('POST /admin/api/auth/login rate limited → 429 after 10 attempts same IP + email', async () => {
    const app = makeApp()
    // Use an email and IP unique to this test to avoid state bleed from other tests
    const email = 'rl-unique@auth-int.test'
    const ip    = '10.9.8.100'

    for (let i = 0; i < 10; i++) {
      const r = await login(app, email, 'any', ip)
      expect(r.status).toBe(401) // user doesn't exist → INVALID_CREDENTIALS
    }

    const res = await login(app, email, 'any', ip)

    expect(res.status).toBe(429)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(res.headers.get('retry-after')).not.toBeNull()
  })

  it('POST /admin/api/auth/refresh with valid refresh_token → issues new auth_token', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const refreshToken = extractCookie(loginRes, 'refresh_token')
    expect(refreshToken).toBeTruthy()

    const refreshRes = await app.request('/admin/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    })

    expect(refreshRes.status).toBe(200)
    const body = await refreshRes.json() as { ok: boolean }
    expect(body.ok).toBe(true)
    // A fresh auth_token must be set in the response
    expect(extractCookie(refreshRes, 'auth_token')).toBeTruthy()
  })

  it('POST /admin/api/auth/refresh with expired refresh_token → 401 TOKEN_EXPIRED', async () => {
    const app = makeApp()

    // Sign a token with -1 s TTL so expires_at is already in the past
    const expiredToken = await signToken(
      { user_id: ADMIN_ID, role: 'admin', token_version: 0 },
      -1,
    )

    const res = await app.request('/admin/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${expiredToken}` },
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_EXPIRED')
  })

  it('POST /admin/api/auth/logout → increments token_version, subsequent request → 401', async () => {
    const app = makeApp()

    const loginRes = await login(app, ADMIN_EMAIL, ADMIN_PW)
    const authToken = extractCookie(loginRes, 'auth_token')
    expect(authToken).toBeTruthy()

    const logoutRes = await app.request('/admin/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `auth_token=${authToken}` },
    })
    expect(logoutRes.status).toBe(200)
    expect((await logoutRes.json() as { ok: boolean }).ok).toBe(true)

    // Old token's token_version is now stale — must be rejected
    const subsequentRes = await app.request('/admin/api/users', {
      headers: { cookie: `auth_token=${authToken}` },
    })
    expect(subsequentRes.status).toBe(401)
    const body = await subsequentRes.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_INVALID')
  })
})
