import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSecurityHeadersMiddleware } from '../security-headers'

describe('createSecurityHeadersMiddleware', () => {
  it('sets the core security headers on responses', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware())
    app.get('/x', (c) => c.json({ ok: true }))
    const res = await app.request('/x')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  it("connect-src defaults to 'self' when no origins are provided", async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware())
    app.get('/x', (c) => c.json({ ok: true }))
    const res = await app.request('/x')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("connect-src 'self'")
    // font-src allows data: — Vite inlines small @fontsource subsets as data: URIs.
    expect(csp).toContain("font-src 'self' data:")
  })

  it('includes provided upload origins in connect-src', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware({
      connectSrc: ['https://my-bucket.s3.us-west-2.amazonaws.com'],
    }))
    app.get('/x', (c) => c.json({ ok: true }))
    const res = await app.request('/x')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("connect-src 'self' https://my-bucket.s3.us-west-2.amazonaws.com")
  })

  // ── GraphiQL CSP exception (ADR api/0010) ───────────────────────────────────
  //
  // Yoga's GraphiQL loads its UI from a CDN and boots via inline scripts, which
  // the strict script-src blocks. The relaxation must apply to that one path and
  // nowhere else.

  it('keeps the strict script-src when graphiqlPath is not set', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware())
    app.get('/graphql', (c) => c.text('explorer'))
    const res = await app.request('/graphql')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unpkg.com')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('relaxes script-src and style-src on the GraphiQL path when enabled', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware({ graphiqlPath: '/graphql' }))
    app.get('/graphql', (c) => c.text('explorer'))
    const res = await app.request('/graphql')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://unpkg.com")
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://unpkg.com")
    // The rest of the policy is unchanged.
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("default-src 'self'")
  })

  it('allows GraphiQL to fetch and spawn its Monaco editor workers', async () => {
    // The explorer fetches three worker bundles from the CDN and runs them from
    // blob: URLs; without connect-src/worker-src the editor silently degrades.
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware({
      connectSrc: ['https://my-bucket.s3.us-west-2.amazonaws.com'],
      graphiqlPath: '/graphql',
    }))
    app.get('/graphql', (c) => c.text('explorer'))
    const res = await app.request('/graphql')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain(
      "connect-src 'self' https://my-bucket.s3.us-west-2.amazonaws.com https://unpkg.com",
    )
    expect(csp).toContain("worker-src 'self' blob:")
  })

  it('never emits worker-src or the CDN in connect-src outside GraphiQL', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware({ graphiqlPath: '/graphql' }))
    app.get('/admin', (c) => c.text('spa'))
    const res = await app.request('/admin')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).not.toContain('worker-src')
    expect(csp).not.toContain('unpkg.com')
    expect(csp).toContain("connect-src 'self'")
  })

  it('does NOT relax other paths when the GraphiQL path is enabled', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware({ graphiqlPath: '/graphql' }))
    app.get('/admin', (c) => c.text('spa'))
    app.get('/api/posts', (c) => c.json({ ok: true }))
    for (const path of ['/admin', '/api/posts']) {
      const res = await app.request(path)
      const csp = res.headers.get('Content-Security-Policy') ?? ''
      expect(csp, path).toContain("script-src 'self'")
      expect(csp, path).not.toContain('unpkg.com')
      expect(csp, path).not.toContain("script-src 'self' 'unsafe-inline'")
    }
  })
})
