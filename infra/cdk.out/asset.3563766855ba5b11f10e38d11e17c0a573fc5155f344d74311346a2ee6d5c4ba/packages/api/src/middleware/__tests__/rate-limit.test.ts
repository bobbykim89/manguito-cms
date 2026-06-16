import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createRateLimitMiddleware } from '../rate-limit'

function buildApp(options: Parameters<typeof createRateLimitMiddleware>[0]) {
  const app = new Hono()
  // Each call to buildApp creates a fresh middleware instance with its own in-process state.
  app.use('/list', createRateLimitMiddleware(options))
  app.get('/list', (c) => c.json({ ok: true }))
  return app
}

describe('rate-limit middleware', () => {
  it('authenticated request (valid auth_token cookie) bypasses rate limiter', async () => {
    // maxPerIp=1 so a second unauthenticated request from the same IP would be blocked,
    // but the cookie-carrying request should always pass regardless.
    const app = buildApp({ windowMs: 60_000, maxPerIp: 1, maxGlobal: 500 })
    const ip = '10.0.0.1'

    // consume the one allowed slot
    await app.request('/list', { headers: { 'x-forwarded-for': ip } })

    // authenticated request — must bypass the exhausted per-IP budget
    const res = await app.request('/list', {
      headers: {
        'x-forwarded-for': ip,
        'cookie': 'auth_token=valid-token-here',
      },
    })
    expect(res.status).toBe(200)
  })

  it('per-IP limit: 31st request from same IP returns 429 RATE_LIMITED', async () => {
    const app = buildApp({ windowMs: 60_000, maxPerIp: 30, maxGlobal: 1000 })
    const ip = '10.0.0.2'

    for (let i = 0; i < 30; i++) {
      const r = await app.request('/list', { headers: { 'x-forwarded-for': ip } })
      expect(r.status).toBe(200)
    }

    const res = await app.request('/list', { headers: { 'x-forwarded-for': ip } })
    expect(res.status).toBe(429)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
  })

  it('global ceiling: request returns 429 when global count exceeds maxGlobal', async () => {
    const app = buildApp({ windowMs: 60_000, maxPerIp: 100, maxGlobal: 5 })

    // exhaust the global budget using 5 distinct IPs
    for (let i = 0; i < 5; i++) {
      const r = await app.request('/list', { headers: { 'x-forwarded-for': `192.168.1.${i + 1}` } })
      expect(r.status).toBe(200)
    }

    // 6th request from a new IP hits the global ceiling
    const res = await app.request('/list', { headers: { 'x-forwarded-for': '9.9.9.9' } })
    expect(res.status).toBe(429)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
  })

  it('429 response includes Retry-After and X-RateLimit-* headers', async () => {
    const app = buildApp({ windowMs: 60_000, maxPerIp: 1, maxGlobal: 500 })
    const ip = '10.0.0.3'

    // consume the one allowed request
    await app.request('/list', { headers: { 'x-forwarded-for': ip } })

    const res = await app.request('/list', { headers: { 'x-forwarded-for': ip } })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy()
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy()
  })
})
