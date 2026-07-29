import type { MiddlewareHandler } from 'hono'

export type SecurityHeadersOptions = {
  /** Extra origins allowed for connect-src (e.g. the storage upload host). */
  connectSrc?: string[]
  /**
   * Path of the GraphiQL explorer (e.g. `/graphql`), set ONLY when GraphiQL is
   * enabled. That one path gets a relaxed CSP so the explorer can boot; every
   * other route keeps the strict policy. Leave undefined to disable entirely.
   */
  graphiqlPath?: string
}

/** CDN origin Yoga's GraphiQL loads its UI bundle and stylesheet from. */
const GRAPHIQL_CDN = 'https://unpkg.com'

/**
 * Conservative security headers. CSP allows same-origin scripts/styles/fonts
 * for the admin SPA (served same-origin) and blocks framing. connect-src is
 * 'self' plus any storage upload origins passed in — presigned uploads go
 * browser→storage directly (ADR api/0004), so that host must be allowlisted.
 *
 * The GraphiQL explorer is the one documented exception: its UI is a CDN bundle
 * booted by inline scripts, which the strict policy blocks. When `graphiqlPath`
 * is set (i.e. GraphiQL is enabled — off in production by default), requests to
 * exactly that path get `'unsafe-inline'` + the CDN origin for script/style.
 * The relaxation is scoped to that single path and never applies to the admin
 * SPA, the REST API, or GraphQL POST queries from other origins.
 */
export function createSecurityHeadersMiddleware(
  options: SecurityHeadersOptions = {},
): MiddlewareHandler {
  const connectSrc = ["'self'", ...(options.connectSrc ?? [])].join(' ')

  type CspParts = {
    scriptSrc: string
    styleSrc: string
    connectSrc: string
    /** Emitted only for GraphiQL, which runs Monaco editor workers off blob: URLs. */
    workerSrc?: string
  }

  function buildCsp(parts: CspParts): string {
    return [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "media-src 'self' https:",
      `style-src ${parts.styleSrc}`,
      `script-src ${parts.scriptSrc}`,
      "font-src 'self' data:",
      `connect-src ${parts.connectSrc}`,
      ...(parts.workerSrc ? [`worker-src ${parts.workerSrc}`] : []),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  }

  const csp = buildCsp({
    scriptSrc: "'self'",
    styleSrc: "'self' 'unsafe-inline'",
    connectSrc,
  })

  // GraphiQL needs four exceptions, all confined to its own path: the CDN for
  // the UI bundle + stylesheet, 'unsafe-inline' for its bootstrap scripts,
  // connect-src for the Monaco worker bundles it fetches from that CDN, and
  // worker-src blob: because it spawns those workers from Blob URLs.
  const graphiqlCsp = buildCsp({
    scriptSrc: `'self' 'unsafe-inline' ${GRAPHIQL_CDN}`,
    styleSrc: `'self' 'unsafe-inline' ${GRAPHIQL_CDN}`,
    connectSrc: `${connectSrc} ${GRAPHIQL_CDN}`,
    workerSrc: "'self' blob:",
  })
  const graphiqlPath = options.graphiqlPath

  return async function securityHeaders(c, next) {
    await next()
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    const isGraphiql = graphiqlPath !== undefined && c.req.path === graphiqlPath
    c.res.headers.set('Content-Security-Policy', isGraphiql ? graphiqlCsp : csp)
  }
}
