import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createPermissionMiddleware } from '../permission'
import type { RolesRegistry } from '../../auth/registry'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REGISTRY: RolesRegistry = {
  admin: {
    name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0,
    permissions: ['content:read', 'content:create', 'content:edit', 'content:delete',
                  'users:read', 'users:create', 'users:edit', 'users:delete'],
  },
  viewer: {
    name: 'viewer', label: 'Viewer', is_system: true, hierarchy_level: 4,
    permissions: ['content:read'],
  },
}

const requirePermission = createPermissionMiddleware(REGISTRY)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(userRole: string | undefined, permission: Parameters<typeof requirePermission>[0]) {
  const app = new Hono()
  app.use('/resource', async (c, next) => {
    if (userRole !== undefined) {
      ;(c as unknown as { set(k: string, v: unknown): void }).set('user', { role: userRole })
    }
    await next()
  })
  app.get('/resource', requirePermission(permission), (c) => c.json({ ok: true }))
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createPermissionMiddleware', () => {
  it('role with the required permission → passes through', async () => {
    const app = buildApp('admin', 'users:delete')

    const res = await app.request('/resource')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('role without the required permission → 403 INSUFFICIENT_PERMISSION', async () => {
    // viewer only has content:read
    const app = buildApp('viewer', 'users:delete')

    const res = await app.request('/resource')

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })

  it('unknown role (not in registry) → 403 INSUFFICIENT_PERMISSION', async () => {
    const app = buildApp('ghost-role', 'content:read')

    const res = await app.request('/resource')

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
  })
})
