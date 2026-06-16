import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { mustChangePasswordCheck } from '../must-change-password'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(user: { must_change_password: boolean } | undefined, path: string) {
  const app = new Hono()
  // Set user on context before mustChangePasswordCheck runs
  app.use(path, async (c, next) => {
    if (user !== undefined) {
      ;(c as unknown as { set(k: string, v: unknown): void }).set('user', user)
    }
    await next()
  })
  app.use(path, mustChangePasswordCheck)
  app.all(path, (c) => c.json({ ok: true }))
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mustChangePasswordCheck', () => {
  it('must_change_password: true on a non-exempt route → 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const app = buildApp({ must_change_password: true }, '/admin/api/users')

    const res = await app.request('/admin/api/users')

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('must_change_password: true on POST /admin/api/users/change-password → passes through', async () => {
    const path = '/admin/api/users/change-password'
    const app = buildApp({ must_change_password: true }, path)

    const res = await app.request(path, { method: 'POST' })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('must_change_password: false → passes through on any route', async () => {
    const app = buildApp({ must_change_password: false }, '/admin/api/content')

    const res = await app.request('/admin/api/content')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
