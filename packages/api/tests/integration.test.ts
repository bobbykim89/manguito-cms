import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { seedSystemTables } from '@bobbykim/manguito-cms-db'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { signToken } from '../src/auth/jwt'
import {
  getTestDb,
  teardownTestData,
  testParsedSchema,
  testRoleUsers,
  createTestApp,
  authenticatedRequest,
} from '@bobbykim/manguito-cms-test-utils'

// ─── Routes derived from testParsedSchema ─────────────────────────────────────
//
// content--article: admin routes are keyed by the content type machine name
// (stable), public routes by default_base_path = 'blog' (the published URL).
// → admin routes:  /admin/api/content/content--article
// → public routes: /api/blog/:slug

const ADMIN_ARTICLES = '/admin/api/content/content--article'
const articlePath = (id: string) => `/admin/api/content/content--article/${id}`
const publicSlug = (slug: string) => `/api/blog/${slug}`

// ─── Shared state ─────────────────────────────────────────────────────────────

let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>
let blogBasePathId: string

// ─── Cookie helper ────────────────────────────────────────────────────────────

function extractCookie(res: Response, name: string): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';')
    const eqIdx = (pair ?? '').indexOf('=')
    if (eqIdx === -1) continue
    const cookieName = (pair ?? '').slice(0, eqIdx).trim()
    if (cookieName === name) return (pair ?? '').slice(eqIdx + 1).trim()
  }
  return undefined
}

// ─── Global setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Must be set before any signToken / verifyToken call — both read it lazily.
  // test-utils/requests.ts also falls back to this value when signing pre-auth JWTs.
  process.env['AUTH_SECRET'] = 'api-integration-test-secret'

  db = await getTestDb()

  // Re-seed system tables defensively: other test files (auth.integration.test.ts)
  // truncate roles and users in their own setup, which would leave this suite
  // without any data to work with.
  await seedSystemTables(db, testParsedSchema)

  for (const user of testRoleUsers) {
    const hash = await hashPassword(user.password)
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
          SELECT ${user.id}, ${user.email}, ${hash}, r.id, ${user.token_version}, ${user.must_change_password}
          FROM roles r WHERE r.name = ${user.role}
          ON CONFLICT (email) DO NOTHING`,
    )
  }

  // Resolve the 'blog' base path ID seeded by globalSetup / seedSystemTables.
  // Content articles need base_path_id (NOT NULL column) on insert.
  const bpResult = await db.execute(
    sql`SELECT id FROM base_paths WHERE name = 'blog' LIMIT 1`,
  )
  blogBasePathId = (bpResult.rows[0] as { id: string }).id

  // Ensure the content_article table exists. globalSetup creates it via
  // migrations, but when this test file runs outside the full suite (e.g.
  // pnpm test --filter api), drizzle-kit lives only in packages/db and is not
  // accessible. Raw SQL with IF NOT EXISTS is idempotent and has no dependency
  // on drizzle-kit's PATH.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS content_article (
      id           UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
      slug         VARCHAR   NOT NULL UNIQUE,
      base_path_id UUID      NOT NULL,
      published    BOOLEAN   NOT NULL DEFAULT false,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      title        VARCHAR,
      body         TEXT,
      cover        UUID,
      category     UUID,
      published_at TIMESTAMP,
      priority     INTEGER
    )
  `))

  // The article fixture has a many-to-many "tags" field — its junction table is
  // written by every create/update (delete + reinsert), so it must exist too.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS junction_content_article_tags (
      left_id  UUID NOT NULL,
      right_id UUID NOT NULL
    )
  `))

  app = createTestApp(testParsedSchema, db)
}, 30_000)

afterAll(async () => {
  delete process.env['AUTH_SECRET']
})

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe('auth gate', () => {
  it('GET /admin/api/blog without token → 401 UNAUTHORIZED', async () => {
    const res = await app.request(ADMIN_ARTICLES)

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('GET /admin/api/users without token → 401 UNAUTHORIZED', async () => {
    const res = await app.request('/admin/api/users')

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})

// ─── Auth flow ────────────────────────────────────────────────────────────────

describe('auth flow', () => {
  // Throwaway user for logout / token_version tests so global role users are not touched.
  const THROWAWAY_ID = 'ff010000-0000-0000-0000-000000000001'
  const THROWAWAY_EMAIL = 'logout-test@integration.test'

  afterAll(async () => {
    await db.execute(sql`DELETE FROM users WHERE id = ${THROWAWAY_ID}`)
  })

  it('POST /admin/api/auth/login correct credentials → 200, Set-Cookie with auth_token HttpOnly SameSite=Strict', async () => {
    const editor = testRoleUsers.find((u) => u.role === 'editor')!

    const res = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editor.email, password: editor.password }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { email: string; role: string } }
    expect(body.ok).toBe(true)
    expect(body.data.role).toBe('editor')

    const setCookies = res.headers.getSetCookie()
    const authCookie = setCookies.find((c) => c.startsWith('auth_token='))
    expect(authCookie).toBeTruthy()
    expect(authCookie).toContain('HttpOnly')
    expect(authCookie).toContain('SameSite=Strict')
  })

  it('POST /admin/api/auth/login wrong password → 401 INVALID_CREDENTIALS', async () => {
    const editor = testRoleUsers.find((u) => u.role === 'editor')!

    const res = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editor.email, password: 'definitely-wrong-password' }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('POST /admin/api/auth/refresh with valid refresh_token → 200, new auth_token cookie set', async () => {
    const editor = testRoleUsers.find((u) => u.role === 'editor')!

    const loginRes = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editor.email, password: editor.password }),
    })
    const refreshToken = extractCookie(loginRes, 'refresh_token')
    expect(refreshToken).toBeTruthy()

    const refreshRes = await app.request('/admin/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    })

    expect(refreshRes.status).toBe(200)
    expect(extractCookie(refreshRes, 'auth_token')).toBeTruthy()
  })

  it('POST /admin/api/auth/logout → 200, subsequent request with old token → 401 TOKEN_INVALID', async () => {
    // Use a throwaway user to avoid invalidating the global editor fixture.
    // Logout increments token_version in DB, which would break authenticatedRequest()
    // for all subsequent tests that use the editor role.
    await db.execute(sql`DELETE FROM users WHERE id = ${THROWAWAY_ID}`)
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
          SELECT ${THROWAWAY_ID}, ${THROWAWAY_EMAIL}, 'hash', r.id, 0, false
          FROM roles r WHERE r.name = 'editor'`,
    )

    const token = await signToken(
      { user_id: THROWAWAY_ID, role: 'editor', token_version: 0 },
      7200,
    )

    const logoutRes = await app.request('/admin/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `auth_token=${token}` },
    })
    expect(logoutRes.status).toBe(200)

    // Old token now has stale token_version (0 in token, 1 in DB after logout)
    const subsequentRes = await app.request('/admin/api/users', {
      headers: { cookie: `auth_token=${token}` },
    })
    expect(subsequentRes.status).toBe(401)
    const body = await subsequentRes.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_INVALID')
  })

  it('token_version mismatch → 401 TOKEN_INVALID', async () => {
    // Sign a token with token_version 999 — DB has 0 (from globalSetup) → mismatch
    const editor = testRoleUsers.find((u) => u.role === 'editor')!
    const staleToken = await signToken(
      { user_id: editor.id, role: 'editor', token_version: 999 },
      7200,
    )

    const res = await app.request('/admin/api/users', {
      headers: { cookie: `auth_token=${staleToken}` },
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_INVALID')
  })
})

// ─── JWT expiry ───────────────────────────────────────────────────────────────

describe('JWT expiry', () => {
  const editor = testRoleUsers.find((u) => u.role === 'editor')!

  // Tokens are signed BEFORE fake timers are enabled to capture real timestamps.
  // Fake timers are then used to advance Date.now() without touching actual I/O.
  let shortLivedToken: string    // expires in 100 s
  let twentyMinToken: string     // expires in 20 min (within 30-min proactive window)
  let twoHourToken: string       // expires in 2 h (outside 30-min proactive window)

  beforeAll(async () => {
    shortLivedToken = await signToken({ user_id: editor.id, role: 'editor', token_version: 0 }, 100)
    twentyMinToken  = await signToken({ user_id: editor.id, role: 'editor', token_version: 0 }, 1200)
    twoHourToken    = await signToken({ user_id: editor.id, role: 'editor', token_version: 0 }, 7200)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('token with expires_at in the past → 401 TOKEN_EXPIRED', async () => {
    vi.useFakeTimers()
    // Advance 200 s past the 100-s TTL — token is now expired
    vi.advanceTimersByTime(200 * 1000)

    const res = await app.request(ADMIN_ARTICLES, {
      headers: { cookie: `auth_token=${shortLivedToken}` },
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_EXPIRED')
  })

  it('token expiring within 30 minutes → 200, new auth_token issued in Set-Cookie', async () => {
    vi.useFakeTimers()
    // Do not advance — token expires in 20 min, which is within the 30-min threshold

    const res = await app.request(ADMIN_ARTICLES, {
      headers: { cookie: `auth_token=${twentyMinToken}` },
    })

    // Token is valid, so request succeeds
    expect(res.status).toBe(200)
    // Proactive refresh: expires_at (now + 20 min) < now + 30 min → new token issued
    const setCookies = res.headers.getSetCookie()
    const newAuth = setCookies.find((c) => c.startsWith('auth_token='))
    expect(newAuth).toBeTruthy()
  })

  it('token with > 30 minutes remaining → 200, no new auth_token in Set-Cookie', async () => {
    vi.useFakeTimers()
    // Do not advance — token expires in 2 h, which is beyond the 30-min threshold

    const res = await app.request(ADMIN_ARTICLES, {
      headers: { cookie: `auth_token=${twoHourToken}` },
    })

    expect(res.status).toBe(200)
    // No proactive refresh: expires_at (now + 2 h) is NOT < now + 30 min
    const setCookies = res.headers.getSetCookie()
    const newAuth = setCookies.find((c) => c.startsWith('auth_token='))
    expect(newAuth).toBeUndefined()
  })
})

// ─── must_change_password ─────────────────────────────────────────────────────

describe('must_change_password', () => {
  const FORCED_ID    = 'ff020000-0000-0000-0000-000000000002'
  const FORCED_EMAIL = 'forced-change@integration.test'
  const FORCED_PW    = 'ForcedPassword1!'
  let forcedToken: string

  beforeAll(async () => {
    const hash = await hashPassword(FORCED_PW)
    await db.execute(sql`DELETE FROM users WHERE id = ${FORCED_ID}`)
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
          SELECT ${FORCED_ID}, ${FORCED_EMAIL}, ${hash}, r.id, 0, true
          FROM roles r WHERE r.name = 'editor'`,
    )
    forcedToken = await signToken(
      { user_id: FORCED_ID, role: 'editor', token_version: 0 },
      7200,
    )
  })

  afterAll(async () => {
    await teardownTestData(db, 'users', FORCED_ID)
  })

  it('must_change_password: true on any non-exempt route → 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const res = await app.request(ADMIN_ARTICLES, {
      headers: { cookie: `auth_token=${forcedToken}` },
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('must_change_password: true on POST /admin/api/users/change-password → 200, flag cleared in DB', async () => {
    const res = await app.request('/admin/api/users/change-password', {
      method: 'POST',
      headers: {
        cookie: `auth_token=${forcedToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ current_password: FORCED_PW, new_password: 'NewPassword2!' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify must_change_password was cleared in DB
    const row = await db.execute(
      sql`SELECT must_change_password FROM users WHERE id = ${FORCED_ID} LIMIT 1`,
    )
    expect((row.rows[0] as { must_change_password: boolean }).must_change_password).toBe(false)
  })
})

// ─── Content CRUD — articles ──────────────────────────────────────────────────

describe('content CRUD — articles', () => {
  let articleId: string
  let articleSlug: string

  afterAll(async () => {
    // Defensive cleanup if the delete test didn't run or failed
    if (articleId) {
      const exists = await db.execute(
        sql`SELECT id FROM content_article WHERE id = ${articleId} LIMIT 1`,
      )
      if ((exists.rows as unknown[]).length > 0) {
        await teardownTestData(db, 'content_article', articleId)
      }
    }
  })

  it('POST /admin/api/blog as editor → 201, returns article with id and slug', async () => {
    articleSlug = `int-test-${Date.now()}`

    const res = await authenticatedRequest(app, 'editor', 'POST', ADMIN_ARTICLES, {
      body: {
        slug: articleSlug,
        base_path_id: blogBasePathId,
        title: 'Integration Test Article',
        body: 'Integration test article body.',
      },
    })

    expect(res.status).toBe(201)
    const result = await res.json() as { ok: boolean; data: { id: string; slug: string } }
    expect(result.ok).toBe(true)
    expect(typeof result.data.id).toBe('string')
    expect(result.data.slug).toBe(articleSlug)

    articleId = result.data.id
  })

  it('GET /admin/api/blog/:id → 200, matches created article', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', articlePath(articleId))

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean; data: { id: string; slug: string } }
    expect(result.ok).toBe(true)
    expect(result.data.id).toBe(articleId)
    expect(result.data.slug).toBe(articleSlug)
  })

  it('GET /admin/api/blog → 200, includes created article in list', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', ADMIN_ARTICLES)

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean; data: unknown[]; meta: { total: number } }
    expect(result.ok).toBe(true)
    const found = (result.data as { id: string }[]).some((item) => item.id === articleId)
    expect(found).toBe(true)
  })

  it('PATCH /admin/api/blog/:id (update title) → 200', async () => {
    const res = await authenticatedRequest(app, 'editor', 'PATCH', articlePath(articleId), {
      body: { title: 'Updated Integration Test Article' },
    })

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean; data: { title: string } }
    expect(result.ok).toBe(true)
    expect(result.data.title).toBe('Updated Integration Test Article')
  })

  it('PATCH /admin/api/blog/:id (published: true with all required fields) → 200', async () => {
    const res = await authenticatedRequest(app, 'editor', 'PATCH', articlePath(articleId), {
      body: { published: true, title: 'Published Integration Test Article', body: 'Published body.' },
    })

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean; data: { published: boolean } }
    expect(result.ok).toBe(true)
    expect(result.data.published).toBe(true)
  })

  it('GET /api/blog/:slug → 200 (public route sees published item)', async () => {
    const res = await app.request(publicSlug(articleSlug))

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean; data: { slug: string } }
    expect(result.ok).toBe(true)
    expect(result.data.slug).toBe(articleSlug)
  })

  it('PATCH /admin/api/blog/:id (published: false) → 200', async () => {
    const res = await authenticatedRequest(app, 'editor', 'PATCH', articlePath(articleId), {
      body: { published: false },
    })

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean; data: { published: boolean } }
    expect(result.ok).toBe(true)
    expect(result.data.published).toBe(false)
  })

  it('GET /api/blog/:slug → 404 (unpublished item not visible on public route)', async () => {
    const res = await app.request(publicSlug(articleSlug))

    expect(res.status).toBe(404)
  })

  it('DELETE /admin/api/blog/:id → 200', async () => {
    const res = await authenticatedRequest(app, 'editor', 'DELETE', articlePath(articleId))

    expect(res.status).toBe(200)
    const result = await res.json() as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('GET /admin/api/blog/:id → 404 after delete', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', articlePath(articleId))

    expect(res.status).toBe(404)
  })
})

// ─── Permission boundary ──────────────────────────────────────────────────────
//
// NOTE: Content routes currently import requirePermission from middleware/auth.ts
// which is a Phase 5 no-op shim. These tests document the expected behavior once
// permission checking is wired for content routes.

describe('permission boundary', () => {
  it('viewer POST to /admin/api/blog → 403 INSUFFICIENT_PERMISSION', async () => {
    const res = await authenticatedRequest(app, 'viewer', 'POST', ADMIN_ARTICLES, {
      body: { slug: 'perm-test', title: 'Perm Test', body: 'Body.' },
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })

  it('writer DELETE /admin/api/blog/:id → 403 INSUFFICIENT_PERMISSION', async () => {
    // Use a non-existent ID — the permission check should reject before DB lookup
    const res = await authenticatedRequest(
      app, 'writer', 'DELETE', articlePath('00000000-0000-0000-0000-000000000000'),
    )

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })
})

// ─── Config and schema ────────────────────────────────────────────────────────

describe('config and schema', () => {
  it('GET /admin/api/config as editor → 200, has cms_name and version', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', '/admin/api/config')

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      data: { cms_name: string; version: string; roles: unknown[] }
    }
    expect(body.ok).toBe(true)
    expect(typeof body.data.cms_name).toBe('string')
    expect(typeof body.data.version).toBe('string')
  })

  it('GET /admin/api/config response does not contain sensitive config properties', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', '/admin/api/config')
    const body = await res.json() as { data: Record<string, unknown> }
    const data = body.data

    // The config envelope must only expose cms_name, version, and roles
    expect('storage' in data).toBe(false)
    expect('db' in data).toBe(false)
    expect('auth' in data).toBe(false)
    expect('server' in data).toBe(false)
  })

  it('GET /admin/api/config roles list contains only roles below editor hierarchy_level', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', '/admin/api/config')
    const body = await res.json() as {
      data: { roles: { name: string; hierarchy_level: number }[] }
    }

    // editor has hierarchy_level 2; config must only expose roles with level > 2
    // (admin is always excluded, even though level 0 is not > 2)
    const roleNames = body.data.roles.map((r) => r.name)
    expect(roleNames).not.toContain('admin')
    expect(roleNames).not.toContain('manager') // level 1 — not below editor
    expect(roleNames).not.toContain('editor')  // level 2 — same level
    expect(roleNames).toContain('writer')       // level 3 — below editor ✓
    expect(roleNames).toContain('viewer')       // level 4 — below editor ✓
  })

  it('GET /admin/api/schema → 200, data has all four schema type keys', async () => {
    const res = await authenticatedRequest(app, 'editor', 'GET', '/admin/api/schema')

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      data: {
        content_types: unknown[]
        taxonomy_types: unknown[]
        paragraph_types: unknown[]
        enum_types: unknown[]
      }
    }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.content_types)).toBe(true)
    expect(Array.isArray(body.data.taxonomy_types)).toBe(true)
    expect(Array.isArray(body.data.paragraph_types)).toBe(true)
    expect(Array.isArray(body.data.enum_types)).toBe(true)

    // Spot-check that testParsedSchema content is reflected
    const ctNames = (body.data.content_types as { name: string }[]).map((ct) => ct.name)
    expect(ctNames).toContain('content--article')
  })
})
