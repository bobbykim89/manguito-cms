import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { registerAuthRoutes } from '../admin/auth'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

vi.mock('../../auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue('$hashed'),
}))
// Mock JWT helpers used by the login success path and authMiddleware (logout)
vi.mock('../../auth/jwt', () => ({
  signToken: vi.fn().mockResolvedValue('signed-token'),
  verifyToken: vi.fn(),
  setAuthCookie: vi.fn(),
  clearAuthCookie: vi.fn(),
  AUTH_TOKEN_TTL: 7200,
  REFRESH_TOKEN_TTL: 604800,
  PROACTIVE_REFRESH_THRESHOLD: 1800,
}))

import { verifyPassword } from '../../auth/password'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DbMock = { execute: ReturnType<typeof vi.fn> }

function buildApp(db: DbMock) {
  const app = new Hono()
  registerAuthRoutes(app, db as unknown as DrizzlePostgresInstance)
  return app
}

function makeDbWith(rows: Record<string, unknown>[]) {
  return { execute: vi.fn().mockResolvedValue({ rows }) }
}

async function postLogin(
  app: Hono,
  body: { email: string; password: string },
  ip = '127.0.0.1',
) {
  return app.request('/admin/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /admin/api/auth/login', () => {
  it('unknown email → 401 INVALID_CREDENTIALS', async () => {
    // DB returns no user row
    const app = buildApp(makeDbWith([]))

    const res = await postLogin(app, { email: 'nobody@example.com', password: 'any' })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_CREDENTIALS')
    // A dummy compare runs against a fixed hash so the not-found path pays the
    // same bcrypt cost as a real user, closing the user-enumeration timing oracle
    expect(verifyPassword).toHaveBeenCalledTimes(1)
  })

  it('wrong password → 401 INVALID_CREDENTIALS (same response as unknown email)', async () => {
    const userRow = {
      id: 'user-id',
      email: 'user@example.com',
      password_hash: '$hashed_pw',
      role_id: 'role-id',
      token_version: 0,
    }
    vi.mocked(verifyPassword).mockResolvedValueOnce(false)
    const app = buildApp(makeDbWith([userRow]))

    const res = await postLogin(app, { email: 'user@example.com', password: 'wrong' })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_CREDENTIALS')
    // Response is identical to the unknown-email case — no distinction
    expect(body.error.message).toBe('Invalid email or password.')
  })

  it('rate limited → 429 RATE_LIMITED after 10 attempts with same IP + email', async () => {
    // Use a unique email to avoid state bleed from other tests
    const email = 'ratelimit-unique@example.com'
    // DB returns no user so each of the 10 "allowed" attempts fails with 401
    const app = buildApp(makeDbWith([]))

    // First 10 attempts — all allowed by rate limiter, all fail with 401
    for (let i = 0; i < 10; i++) {
      const r = await postLogin(app, { email, password: 'pass' }, '10.0.0.1')
      expect(r.status).toBe(401)
    }

    // 11th attempt from same IP + email — rate limited
    const res = await postLogin(app, { email, password: 'pass' }, '10.0.0.1')

    expect(res.status).toBe(429)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(res.headers.get('retry-after')).not.toBeNull()
  })
})
