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
    expect(csp).toContain("font-src 'self'")
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
})
