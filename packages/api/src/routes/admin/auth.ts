import type { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { sql } from 'drizzle-orm'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { verifyPassword } from '../../auth/password.js'
import {
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  AUTH_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from '../../auth/jwt.js'
import { createAuthMiddleware } from '../../middleware/auth.js'

// ─── Rate limiting ────────────────────────────────────────────────────────────

const loginAttempts = new Map<string, number[]>()

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const attempts = (loginAttempts.get(key) ?? []).filter((t) => t > windowStart)
  attempts.push(now)
  loginAttempts.set(key, attempts)

  if (attempts.length > RATE_LIMIT_MAX) {
    const oldestInWindow = attempts[0]!
    const retryAfterSeconds = Math.ceil((oldestInWindow + RATE_LIMIT_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

// ─── DB row types ─────────────────────────────────────────────────────────────

type LoginUserRow = {
  id: string
  email: string
  password_hash: string
  role_id: string
  token_version: number
}

type RefreshRow = {
  token_version: number
  role: string
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerAuthRoutes(app: Hono, db: DrizzlePostgresInstance): void {
  const invalidCredentials = {
    ok: false,
    error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
  } as const

  // POST /admin/api/auth/login
  app.post('/admin/api/auth/login', async (c) => {
    let body: { email?: unknown; password?: unknown }
    try {
      body = (await c.req.json()) as { email?: unknown; password?: unknown }
    } catch {
      return c.json(invalidCredentials, 401)
    }

    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
    const password = typeof body.password === 'string' ? body.password : null

    if (!email || !password) {
      return c.json(invalidCredentials, 401)
    }

    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rateCheck = checkRateLimit(`${ip}:${email}`)
    if (!rateCheck.allowed) {
      c.header('Retry-After', String(rateCheck.retryAfterSeconds))
      return c.json(
        {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many login attempts. Please try again later.',
          },
        },
        429,
      )
    }

    const userResult = await db.execute(
      sql`SELECT id, email, password_hash, role_id, token_version
          FROM users WHERE email = ${email} LIMIT 1`,
    )
    const user = userResult.rows[0] as LoginUserRow | undefined

    if (!user) {
      return c.json(invalidCredentials, 401)
    }

    const passwordValid = await verifyPassword(password, user.password_hash)
    if (!passwordValid) {
      return c.json(invalidCredentials, 401)
    }

    const roleResult = await db.execute(
      sql`SELECT r.name AS name, u.must_change_password
          FROM roles r
          JOIN users u ON u.role_id = r.id
          WHERE r.id = ${user.role_id} AND u.id = ${user.id}
          LIMIT 1`,
    )
    const roleRow = roleResult.rows[0] as { name: string; must_change_password: boolean } | undefined

    if (!roleRow) {
      return c.json(
        { ok: false, error: { code: 'INVALID_ROLE', message: 'User role not found.' } },
        500,
      )
    }

    const [authToken, refreshToken] = await Promise.all([
      signToken(
        { user_id: user.id, role: roleRow.name, token_version: user.token_version },
        AUTH_TOKEN_TTL,
      ),
      signToken(
        { user_id: user.id, role: roleRow.name, token_version: user.token_version },
        REFRESH_TOKEN_TTL,
      ),
    ])

    setAuthCookie(c, 'auth_token', authToken, { path: '/' })
    setAuthCookie(c, 'refresh_token', refreshToken, { path: '/admin/api/auth' })

    return c.json({
      ok: true,
      data: {
        id: user.id,
        email: user.email,
        role: roleRow.name,
        must_change_password: roleRow.must_change_password,
      },
    })
  })

  // POST /admin/api/auth/refresh
  app.post('/admin/api/auth/refresh', async (c) => {
    const token = getCookie(c, 'refresh_token')
    if (!token) {
      return c.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
        401,
      )
    }

    let payload
    try {
      payload = await verifyToken(token)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'TOKEN_EXPIRED') {
        return c.json(
          { ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Token has expired.' } },
          401,
        )
      }
      return c.json(
        { ok: false, error: { code: 'TOKEN_INVALID', message: 'Token signature is invalid.' } },
        401,
      )
    }

    const rowResult = await db.execute(
      sql`SELECT u.token_version, r.name AS role
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.id = ${payload.user_id}
          LIMIT 1`,
    )
    const row = rowResult.rows[0] as RefreshRow | undefined

    if (!row || payload.token_version !== row.token_version) {
      return c.json(
        { ok: false, error: { code: 'TOKEN_INVALID', message: 'Token has been invalidated.' } },
        401,
      )
    }

    const newAuthToken = await signToken(
      { user_id: payload.user_id, role: row.role, token_version: row.token_version },
      AUTH_TOKEN_TTL,
    )
    setAuthCookie(c, 'auth_token', newAuthToken, { path: '/' })

    return c.json({ ok: true })
  })

  // POST /admin/api/auth/logout
  const authMiddleware = createAuthMiddleware(db)
  app.post('/admin/api/auth/logout', authMiddleware, async (c) => {
    const user = (c as unknown as { get(k: 'user'): { id: string; role: string } }).get('user')

    await db.execute(
      sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${user.id}`,
    )

    clearAuthCookie(c, 'auth_token')
    clearAuthCookie(c, 'refresh_token', '/admin/api/auth')

    return c.json({ ok: true })
  })
}
