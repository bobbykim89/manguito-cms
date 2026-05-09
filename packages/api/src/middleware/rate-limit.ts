import type { MiddlewareHandler } from 'hono'

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
