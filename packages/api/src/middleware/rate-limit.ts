import type { MiddlewareHandler } from 'hono'
import type { ResolvedRateLimitConfig } from '@bobbykim/manguito-cms-core'

// Defaults for the public list-endpoint limiter. Single source of truth —
// createCmsApp resolves its limiter through resolveListRateLimit below.
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_PER_IP = 30
const DEFAULT_MAX_GLOBAL = 500

export type RateLimitOptions = {
  windowMs: number
  maxPerIp: number
  maxGlobal: number
}

export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, maxPerIp, maxGlobal } = options
  const ipRequests = new Map<string, number[]>()
  const globalRequests: number[] = []

  return async function rateLimitMiddleware(c, next) {
    const authToken = c.req.raw.headers.get('cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('auth_token='))

    if (authToken) {
      return next()
    }

    const now = Date.now()
    const cutoff = now - windowMs

    // purge stale global entries
    let gi = 0
    while (gi < globalRequests.length && globalRequests[gi]! < cutoff) gi++
    globalRequests.splice(0, gi)

    // get client IP
    const forwarded = c.req.header('x-forwarded-for')
    const ip = forwarded ? forwarded.split(',')[0]!.trim() : (c.env?.incoming?.socket?.remoteAddress ?? 'unknown')

    // purge stale IP entries
    const ipTimes = ipRequests.get(ip) ?? []
    let ii = 0
    while (ii < ipTimes.length && ipTimes[ii]! < cutoff) ii++
    ipTimes.splice(0, ii)
    ipRequests.set(ip, ipTimes)

    const retryAfterFromGlobal =
      globalRequests.length > 0
        ? Math.ceil((globalRequests[0]! + windowMs - now) / 1000)
        : 0
    const retryAfterFromIp =
      ipTimes.length > 0 ? Math.ceil((ipTimes[0]! + windowMs - now) / 1000) : 0

    if (globalRequests.length >= maxGlobal) {
      const retryAfter = Math.max(retryAfterFromGlobal, 1)
      const reset = Math.floor((now + retryAfter * 1000) / 1000)
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: `Too many requests. Please retry after ${retryAfter} seconds.` } },
        429,
        {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(maxGlobal),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(reset),
        }
      )
    }

    if (ipTimes.length >= maxPerIp) {
      const retryAfter = Math.max(retryAfterFromIp, 1)
      const reset = Math.floor((now + retryAfter * 1000) / 1000)
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: `Too many requests. Please retry after ${retryAfter} seconds.` } },
        429,
        {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(maxPerIp),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(reset),
        }
      )
    }

    globalRequests.push(now)
    ipTimes.push(now)

    return next()
  }
}

/**
 * Resolves the public list-endpoint config into a middleware, or `undefined`
 * when the limiter is disabled via the `findAll: '*'` wildcard. Route
 * registrators skip registration when this is `undefined`, so a disabled
 * limiter has zero request-path overhead.
 */
export function resolveListRateLimit(
  rateLimit?: ResolvedRateLimitConfig,
): MiddlewareHandler | undefined {
  const findAll = rateLimit?.findAll
  if (findAll === '*') {
    return undefined
  }
  return createRateLimitMiddleware({
    windowMs: findAll?.windowMs ?? DEFAULT_WINDOW_MS,
    maxPerIp: findAll?.maxPerIp ?? DEFAULT_MAX_PER_IP,
    maxGlobal: findAll?.maxGlobal ?? DEFAULT_MAX_GLOBAL,
  })
}
