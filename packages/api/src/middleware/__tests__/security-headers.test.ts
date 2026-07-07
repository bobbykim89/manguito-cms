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
})
