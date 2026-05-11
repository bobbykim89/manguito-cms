import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createHierarchyMiddleware } from '../hierarchy'
import type { RolesRegistry } from '../../auth/registry'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REGISTRY: RolesRegistry = {
  admin:   { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  manager: { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  editor:  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  writer:  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  viewer:  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(
  actingRole: string,
  getUserRole: (id: string) => Promise<string | null>,
) {
  const requireHierarchy = createHierarchyMiddleware(REGISTRY, getUserRole)
  const app = new Hono()
  // Set acting user on context
  app.use('/admin/api/users/:id', async (c, next) => {
    ;(c as unknown as { set(k: string, v: unknown): void }).set('user', { role: actingRole })
    await next()
  })
  app.delete('/admin/api/users/:id', requireHierarchy(), (c) =>
    c.json({ ok: true, id: c.req.param('id') }),
  )
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createHierarchyMiddleware', () => {
  it('acting hierarchy_level 1 (manager) vs target hierarchy_level 2 (editor) → passes through', async () => {
    const getUserRole = vi.fn().mockResolvedValue('editor')
    const app = buildApp('manager', getUserRole)

    const res = await app.request('/admin/api/users/target-id', { method: 'DELETE' })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('acting hierarchy_level 1 (manager) vs target hierarchy_level 1 (manager) → 403 INSUFFICIENT_PRIVILEGE', async () => {
    const getUserRole = vi.fn().mockResolvedValue('manager')
    const app = buildApp('manager', getUserRole)

    const res = await app.request('/admin/api/users/target-id', { method: 'DELETE' })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PRIVILEGE')
  })

  it('acting hierarchy_level 1 (manager) vs target hierarchy_level 0 (admin) → 403 INSUFFICIENT_PRIVILEGE', async () => {
    const getUserRole = vi.fn().mockResolvedValue('admin')
    const app = buildApp('manager', getUserRole)

    const res = await app.request('/admin/api/users/target-id', { method: 'DELETE' })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PRIVILEGE')
  })

  it('unknown target role (not in registry) → 400 INVALID_ROLE', async () => {
    // getUserRole returns a role name that doesn't exist in the registry
    const getUserRole = vi.fn().mockResolvedValue('super-admin')
    const app = buildApp('manager', getUserRole)

    const res = await app.request('/admin/api/users/target-id', { method: 'DELETE' })

    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_ROLE')
  })
})
