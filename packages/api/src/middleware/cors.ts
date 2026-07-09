import type { MiddlewareHandler } from 'hono'
import type { CorsConfig } from '@bobbykim/manguito-cms-core'

export function createCorsMiddleware(corsConfig: CorsConfig): MiddlewareHandler {
  const allowList = Array.isArray(corsConfig.origin)
    ? corsConfig.origin
    : [corsConfig.origin]
  const wildcard = allowList.includes('*')
  const methods = corsConfig.methods?.join(',') ?? 'GET,POST,PATCH,DELETE,OPTIONS'

  return async function corsMiddleware(c, next) {
    if (corsConfig.enabled === false) {
      return next()
    }

    const requestOrigin = c.req.header('origin')

    if (wildcard) {
      // Wildcard cannot be combined with credentials per the CORS spec.
      c.res.headers.set('Access-Control-Allow-Origin', '*')
    } else if (requestOrigin && allowList.includes(requestOrigin)) {
      c.res.headers.set('Access-Control-Allow-Origin', requestOrigin)
      c.res.headers.set('Vary', 'Origin')
      if (corsConfig.credentials === true) {
        c.res.headers.set('Access-Control-Allow-Credentials', 'true')
      }
    }
    // Non-matching origins: emit no Allow-Origin (browser blocks the read).

    c.res.headers.set('Access-Control-Allow-Methods', methods)
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (c.req.method === 'OPTIONS') {
      return c.newResponse(null, 204)
    }
    return next()
  }
}
