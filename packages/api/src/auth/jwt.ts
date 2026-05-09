import type { Context } from 'hono'
import { sign, verify as jwtVerify } from 'hono/jwt'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { JWTPayload, ErrorCode } from '@bobbykim/manguito-cms-core'

type CookieOptions = NonNullable<Parameters<typeof setCookie>[3]>

// ─── Token lifetimes ──────────────────────────────────────────────────────────

export const AUTH_TOKEN_TTL = 2 * 60 * 60
export const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60
export const PROACTIVE_REFRESH_THRESHOLD = 30 * 60

// ─── JWT helpers ──────────────────────────────────────────────────────────────

export async function signToken(
  payload: Omit<JWTPayload, 'expires_at'>,
  expiresInSeconds: number,
): Promise<string> {
  const secret = process.env['AUTH_SECRET']!
  const fullPayload: JWTPayload = {
    ...payload,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  }
  return sign(fullPayload as Record<string, unknown>, secret)
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const secret = process.env['AUTH_SECRET']!
  let raw: Record<string, unknown>
  try {
    raw = (await jwtVerify(token, secret, 'HS256')) as Record<string, unknown>
  } catch {
    throw Object.assign(new Error('Token signature is invalid'), {
      code: 'TOKEN_INVALID' as ErrorCode,
    })
  }
  const payload = raw as JWTPayload
  if (payload.expires_at < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Token has expired'), {
      code: 'TOKEN_EXPIRED' as ErrorCode,
    })
  }
  return payload
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export function setAuthCookie(
  c: Context,
  name: string,
  token: string,
  options: CookieOptions,
): void {
  setCookie(c, name, token, {
    ...options,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  })
}

export function clearAuthCookie(c: Context, name: string, path?: string): void {
  deleteCookie(c, name, path !== undefined ? { path } : undefined)
}
