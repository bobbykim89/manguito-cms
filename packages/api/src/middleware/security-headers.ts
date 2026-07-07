import type { MiddlewareHandler } from 'hono'

// Conservative defaults. CSP allows same-origin scripts/styles for the admin
// SPA (served same-origin) and blocks framing; tighten per deployment as needed.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function createSecurityHeadersMiddleware(): MiddlewareHandler {
  return async function securityHeaders(c, next) {
    await next()
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    c.res.headers.set('Content-Security-Policy', CSP)
  }
}
