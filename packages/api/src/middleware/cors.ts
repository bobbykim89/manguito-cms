import type { MiddlewareHandler } from 'hono'
import type { CorsConfig } from '@bobbykim/manguito-cms-core'

export function createCorsMiddleware(corsConfig: CorsConfig): MiddlewareHandler {
  return async function corsMiddleware(c, next) {
    if (corsConfig.enabled === false) {
      return next()
    }

    const origins = Array.isArray(corsConfig.origin)
      ? corsConfig.origin
      : corsConfig.origin === '*'
        ? []
        : [corsConfig.origin]

    const originHeader =
      corsConfig.origin === '*' || origins.length === 0 ? '*' : origins.join(',')

    c.res.headers.set('Access-Control-Allow-Origin', originHeader)
    c.res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    c.res.headers.set('Access-Control-Allow-Credentials', 'true')

    if (c.req.method === 'OPTIONS') {
      return c.newResponse(null, 204)
    }

    return next()
  }
}
