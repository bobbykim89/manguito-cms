import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createCorsMiddleware } from '../cors'

function appWith(cors: Parameters<typeof createCorsMiddleware>[0]) {
  const app = new Hono()
  app.use('*', createCorsMiddleware(cors))
  app.get('/x', (c) => c.json({ ok: true }))
  return app
}

describe('createCorsMiddleware', () => {
  it('reflects an allowed origin and sets credentials for a concrete origin', async () => {
    const app = appWith({ origin: 'https://app.example.com', credentials: true })
    const res = await app.request('/x', { headers: { origin: 'https://app.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('does not reflect a non-allowed origin', async () => {
    const app = appWith({ origin: 'https://app.example.com', credentials: true })
    const res = await app.request('/x', { headers: { origin: 'https://evil.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('with wildcard origin, never sends credentials', async () => {
    const app = appWith({ origin: '*' })
    const res = await app.request('/x', { headers: { origin: 'https://anything.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('emits no CORS headers when disabled', async () => {
    const app = appWith({ origin: 'https://app.example.com', enabled: false })
    const res = await app.request('/x', { headers: { origin: 'https://app.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull()
  })

  it('answers an OPTIONS preflight with 204', async () => {
    const app = appWith({ origin: 'https://app.example.com' })
    const res = await app.request('/x', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com' },
    })
    expect(res.status).toBe(204)
  })
})
