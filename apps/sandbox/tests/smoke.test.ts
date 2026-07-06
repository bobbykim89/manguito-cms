import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  getTestDb,
  testParsedSchema,
  testRoleUsers,
  createTestApp,
  authenticatedRequest,
  teardownTestData,
} from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// ─── Shared state ────────────────────────────────────────────────────────────

let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  app = createTestApp(testParsedSchema, db)
}, 30_000)

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Smoke — liveness ────────────────────────────────────────────────────────

describe('smoke — liveness', () => {
  it('GET /api/openapi.json → not 500 (server is alive)', async () => {
    const res = await app.request('/api/openapi.json')
    expect(res.status).not.toBe(500)
  })
})

// ─── Smoke — auth ────────────────────────────────────────────────────────────

describe('smoke — auth', () => {
  const adminUser = testRoleUsers.find((u) => u.role === 'admin')!

  afterAll(async () => {
    // Reset token_version so subsequent describes using authenticatedRequest work
    await db.execute(
      sql`UPDATE users SET token_version = 0 WHERE email = ${adminUser.email}`,
    )
  })

  it('POST /admin/api/auth/login with admin credentials → 200, cookies set', async () => {
    const res = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({ email: adminUser.email, password: adminUser.password }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { email: string; role: string } }
    expect(body.ok).toBe(true)
    expect(body.data.email).toBe(adminUser.email)
    expect(extractCookie(res, 'auth_token')).toBeTruthy()
    expect(extractCookie(res, 'refresh_token')).toBeTruthy()
  })

  it('POST /admin/api/auth/refresh with valid refresh_token → 200, new auth_token', async () => {
    const loginRes = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({ email: adminUser.email, password: adminUser.password }),
    })
    const refreshToken = extractCookie(loginRes, 'refresh_token')
    expect(refreshToken).toBeTruthy()

    const res = await app.request('/admin/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(extractCookie(res, 'auth_token')).toBeTruthy()
  })

  it('POST /admin/api/auth/logout → 200, subsequent request → 401', async () => {
    const loginRes = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({ email: adminUser.email, password: adminUser.password }),
    })
    const authToken = extractCookie(loginRes, 'auth_token')
    expect(authToken).toBeTruthy()

    const logoutRes = await app.request('/admin/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `auth_token=${authToken}` },
    })
    expect(logoutRes.status).toBe(200)
    const logoutBody = await logoutRes.json() as { ok: boolean }
    expect(logoutBody.ok).toBe(true)

    // Stale token rejected after logout because token_version was incremented
    const subsequentRes = await app.request('/admin/api/config', {
      headers: { cookie: `auth_token=${authToken}` },
    })
    expect(subsequentRes.status).toBe(401)
  })
})

// ─── Smoke — content CRUD ────────────────────────────────────────────────────

describe('smoke — content CRUD', () => {
  let articleId: string | undefined
  let basePathId: string

  beforeAll(async () => {
    const result = await db.execute(
      sql`SELECT id FROM base_paths WHERE name = 'blog'`,
    )
    basePathId = (result.rows[0] as { id: string }).id
  })

  afterAll(async () => {
    if (articleId) {
      await teardownTestData(db, 'content_article', articleId)
    }
  })

  it('POST /admin/api/content/content--article → 201', async () => {
    const res = await authenticatedRequest(app, 'admin', 'POST', '/admin/api/content/content--article', {
      body: {
        slug: 'smoke-test-article',
        title: 'Smoke Test Article',
        body: 'Smoke test article body content',
        base_path_id: basePathId,
      },
    })

    expect(res.status).toBe(201)
    const data = await res.json() as { ok: boolean; data: { id: string } }
    expect(data.ok).toBe(true)
    expect(typeof data.data.id).toBe('string')
    articleId = data.data.id
  })

  it('GET /admin/api/content/content--article/:id → 200', async () => {
    expect(articleId).toBeTruthy()
    const res = await authenticatedRequest(app, 'admin', 'GET', `/admin/api/content/content--article/${articleId}`)

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { id: string } }
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe(articleId)
  })

  it('PATCH /admin/api/content/content--article/:id → 200', async () => {
    expect(articleId).toBeTruthy()
    const res = await authenticatedRequest(app, 'admin', 'PATCH', `/admin/api/content/content--article/${articleId}`, {
      body: { title: 'Smoke Test Article Updated' },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { title: string } }
    expect(body.ok).toBe(true)
    expect(body.data.title).toBe('Smoke Test Article Updated')
  })

  it('DELETE /admin/api/content/content--article/:id → 200', async () => {
    expect(articleId).toBeTruthy()
    const res = await authenticatedRequest(app, 'admin', 'DELETE', `/admin/api/content/content--article/${articleId}`)

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
    articleId = undefined
  })
})

// ─── Smoke — permission boundary ─────────────────────────────────────────────

describe('smoke — permission boundary', () => {
  it('viewer POST /admin/api/content/content--article → 403 INSUFFICIENT_PERMISSION', async () => {
    const res = await authenticatedRequest(app, 'viewer', 'POST', '/admin/api/content/content--article', {
      body: { slug: 'viewer-attempt', title: 'Viewer attempt', body: 'body' },
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })
})

// ─── Smoke — internal endpoints ──────────────────────────────────────────────

describe('smoke — internal endpoints', () => {
  it('GET /admin/api/config → 200, ok: true, has cms_name', async () => {
    const res = await authenticatedRequest(app, 'admin', 'GET', '/admin/api/config')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { cms_name: string } }
    expect(body.ok).toBe(true)
    expect(typeof body.data.cms_name).toBe('string')
  })

  it('GET /admin/api/schema → 200, ok: true, has content_types', async () => {
    const res = await authenticatedRequest(app, 'admin', 'GET', '/admin/api/schema')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { content_types: unknown[] } }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.content_types)).toBe(true)
    expect(body.data.content_types.length).toBeGreaterThan(0)
  })
})
