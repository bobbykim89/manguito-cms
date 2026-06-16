import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from '../auth'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { JWTPayload } from '@bobbykim/manguito-cms-core'

vi.mock('../../auth/jwt', () => ({
  verifyToken: vi.fn(),
  signToken: vi.fn().mockResolvedValue('fresh-auth-token'),
  setAuthCookie: vi.fn(),
  AUTH_TOKEN_TTL: 7200,
  PROACTIVE_REFRESH_THRESHOLD: 1800,
}))

import { verifyToken, signToken, setAuthCookie } from '../../auth/jwt'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DbMock = { execute: ReturnType<typeof vi.fn> }

function buildApp(db: DbMock) {
  const app = new Hono()
  app.use('/protected', createAuthMiddleware(db as unknown as DrizzlePostgresInstance))
  app.get('/protected', (c) => {
    const user = (c as unknown as { get(k: string): unknown }).get('user')
    return c.json({ ok: true, user })
  })
  return app
}

function makeDbReturning(row: Record<string, unknown> | undefined): DbMock {
  return {
    execute: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
  }
}

function nowPlusSeconds(s: number): number {
  return Math.floor(Date.now() / 1000) + s
}

const VALID_PAYLOAD: JWTPayload = {
  user_id: 'user-uuid-123',
  role: 'editor',
  token_version: 3,
  expires_at: nowPlusSeconds(7200),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createAuthMiddleware', () => {
  it('missing auth_token cookie → 401 UNAUTHORIZED', async () => {
    const app = buildApp(makeDbReturning(undefined))

    const res = await app.request('/protected')

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('invalid JWT signature → 401 TOKEN_INVALID', async () => {
    vi.mocked(verifyToken).mockRejectedValueOnce(
      Object.assign(new Error('invalid'), { code: 'TOKEN_INVALID' }),
    )
    const app = buildApp(makeDbReturning(undefined))

    const res = await app.request('/protected', {
      headers: { cookie: 'auth_token=bad-token' },
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_INVALID')
  })

  it('expired token → 401 TOKEN_EXPIRED', async () => {
    vi.mocked(verifyToken).mockRejectedValueOnce(
      Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED' }),
    )
    const app = buildApp(makeDbReturning(undefined))

    const res = await app.request('/protected', {
      headers: { cookie: 'auth_token=expired-token' },
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_EXPIRED')
  })

  it('token_version mismatch (DB has higher version) → 401 TOKEN_INVALID', async () => {
    vi.mocked(verifyToken).mockResolvedValueOnce({
      ...VALID_PAYLOAD,
      token_version: 2,  // payload says 2
    })
    // DB says 3 — token was invalidated
    const app = buildApp(makeDbReturning({ token_version: 3, must_change_password: false }))

    const res = await app.request('/protected', {
      headers: { cookie: 'auth_token=stale-token' },
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('TOKEN_INVALID')
  })

  it('valid token → attaches { id, role, must_change_password } to context and calls next', async () => {
    vi.mocked(verifyToken).mockResolvedValueOnce(VALID_PAYLOAD)
    const app = buildApp(makeDbReturning({ token_version: 3, must_change_password: false }))

    const res = await app.request('/protected', {
      headers: { cookie: 'auth_token=valid-token' },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      user: { id: string; role: string; must_change_password: boolean }
    }
    expect(body.ok).toBe(true)
    expect(body.user.id).toBe('user-uuid-123')
    expect(body.user.role).toBe('editor')
    expect(body.user.must_change_password).toBe(false)
  })

  it('proactive refresh: token expires within 30 minutes → new auth_token cookie set', async () => {
    // expires in 500 s — well within the 1800 s threshold
    vi.mocked(verifyToken).mockResolvedValueOnce({
      ...VALID_PAYLOAD,
      expires_at: nowPlusSeconds(500),
    })
    const app = buildApp(makeDbReturning({ token_version: 3, must_change_password: false }))

    await app.request('/protected', { headers: { cookie: 'auth_token=nearly-expired' } })

    expect(signToken).toHaveBeenCalledOnce()
    expect(setAuthCookie).toHaveBeenCalledOnce()
  })

  it('token with >30 minutes remaining → no new cookie set', async () => {
    // expires in 3600 s — beyond the 1800 s threshold
    vi.mocked(verifyToken).mockResolvedValueOnce({
      ...VALID_PAYLOAD,
      expires_at: nowPlusSeconds(3600),
    })
    const app = buildApp(makeDbReturning({ token_version: 3, must_change_password: false }))

    await app.request('/protected', { headers: { cookie: 'auth_token=fresh-token' } })

    expect(signToken).not.toHaveBeenCalled()
    expect(setAuthCookie).not.toHaveBeenCalled()
  })
})
