import type { MiddlewareHandler } from 'hono'

export type SecurityHeadersOptions = {
  /** Extra origins allowed for connect-src (e.g. the storage upload host). */
  connectSrc?: string[]
}

/**
 * Conservative security headers. CSP allows same-origin scripts/styles/fonts
 * for the admin SPA (served same-origin) and blocks framing. connect-src is
 * 'self' plus any storage upload origins passed in — presigned uploads go
 * browser→storage directly (ADR api/0004), so that host must be allowlisted.
 */
export function createSecurityHeadersMiddleware(
  options: SecurityHeadersOptions = {},
): MiddlewareHandler {
  const connectSrc = ["'self'", ...(options.connectSrc ?? [])].join(' ')
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return async function securityHeaders(c, next) {
    await next()
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    c.res.headers.set('Content-Security-Policy', csp)
  }
}
