import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { sql } from 'drizzle-orm'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  verifyToken,
  signToken,
  setAuthCookie,
  AUTH_TOKEN_TTL,
  PROACTIVE_REFRESH_THRESHOLD,
} from '../auth/jwt.js'

type UserRow = {
  token_version: number
  must_change_password: boolean
}

export function createAuthMiddleware(db: DrizzlePostgresInstance): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, 'auth_token')
    if (!token) {
      return c.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
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
          { ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Token has expired' } },
          401,
        )
      }
      return c.json(
        { ok: false, error: { code: 'TOKEN_INVALID', message: 'Token signature is invalid' } },
        401,
      )
    }

    const result = await db.execute(
      sql`SELECT token_version, must_change_password FROM users WHERE id = ${payload.user_id} LIMIT 1`,
    )
    const row = result.rows[0] as UserRow | undefined

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'TOKEN_INVALID', message: 'Token signature is invalid' } },
        401,
      )
    }

    if (payload.token_version !== row.token_version) {
      return c.json(
        { ok: false, error: { code: 'TOKEN_INVALID', message: 'Token has been invalidated' } },
        401,
      )
    }

    c.set('user', {
      id: payload.user_id,
      role: payload.role,
      must_change_password: row.must_change_password,
    })

    const now = Math.floor(Date.now() / 1000)
    if (payload.expires_at < now + PROACTIVE_REFRESH_THRESHOLD) {
      const newToken = await signToken(
        {
          user_id: payload.user_id,
          role: payload.role,
          token_version: payload.token_version,
        },
        AUTH_TOKEN_TTL,
      )
      setAuthCookie(c, 'auth_token', newToken, {})
    }

    await next()
  }
}

// Phase 5 compatibility shims — in use by routes/admin/content.ts and
// routes/admin/media.ts until route wiring is completed in Phase 6.
export const requireAuth: MiddlewareHandler = async (_c, next) => next()
export function requirePermission(_permission: string): MiddlewareHandler {
  return async (_c, next) => next()
}
