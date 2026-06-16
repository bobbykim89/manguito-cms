import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { registerUserRoutes } from '../admin/users'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { MiddlewareHandler } from 'hono'
import type { Permission } from '@bobbykim/manguito-cms-core'

vi.mock('../../auth/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('$hashed-password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

// ─── No-op middleware stubs ───────────────────────────────────────────────────

const noopPermission = (_permission: Permission): MiddlewareHandler =>
  async (_c, next) => { await next() }

const noopHierarchy = (): MiddlewareHandler =>
  async (_c, next) => { await next() }

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DbMock = { execute: ReturnType<typeof vi.fn> }

function buildApp(db: DbMock, actingUserId = 'acting-user-id') {
  const app = new Hono()
  // Inject acting user into context before any route handler runs
  app.use('*', async (c, next) => {
    ;(c as unknown as { set(k: string, v: unknown): void }).set('user', {
      id: actingUserId,
      role: 'admin',
    })
    await next()
  })
  registerUserRoutes(
    app,
    db as unknown as DrizzlePostgresInstance,
    noopPermission,
    noopHierarchy,
  )
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /admin/api/users', () => {
  it('returns temporary_password in the creation response', async () => {
    const db: DbMock = {
      execute: vi.fn()
        // First call: SELECT role_id from roles
        .mockResolvedValueOnce({ rows: [{ id: 'editor-role-id' }] })
        // Second call: INSERT ... RETURNING
        .mockResolvedValueOnce({
          rows: [{
            id: 'new-user-id',
            email: 'new@example.com',
            must_change_password: true,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          }],
        }),
    }
    const app = buildApp(db)

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', role: 'editor' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as {
      ok: boolean
      data: { id: string; temporary_password: string; must_change_password: boolean }
    }
    expect(body.ok).toBe(true)
    expect(typeof body.data.temporary_password).toBe('string')
    expect(body.data.temporary_password.length).toBeGreaterThan(0)
    expect(body.data.must_change_password).toBe(true)
  })
})

describe('GET /admin/api/users/:id', () => {
  it('does not include password_hash, token_version, or temporary_password', async () => {
    // The DB query only selects safe columns; this test confirms nothing leaks
    const safeRow = {
      id: 'user-id-1',
      email: 'user@example.com',
      role: 'editor',
      must_change_password: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    const db: DbMock = {
      execute: vi.fn().mockResolvedValue({ rows: [safeRow] }),
    }
    const app = buildApp(db)

    const res = await app.request('/admin/api/users/user-id-1')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect('password_hash' in body.data).toBe(false)
    expect('token_version' in body.data).toBe(false)
    expect('temporary_password' in body.data).toBe(false)
    expect(body.data['id']).toBe('user-id-1')
    expect(body.data['email']).toBe('user@example.com')
    expect(body.data['role']).toBe('editor')
  })
})

describe('PATCH /admin/api/users/:id', () => {
  it('self role change → 403 INSUFFICIENT_PRIVILEGE', async () => {
    const actingUserId = 'self-user-id'
    const db: DbMock = { execute: vi.fn() }
    const app = buildApp(db, actingUserId)

    // target id === acting user id, and body includes role
    const res = await app.request(`/admin/api/users/${actingUserId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PRIVILEGE')
    // DB must not have been touched
    expect(db.execute).not.toHaveBeenCalled()
  })
})

describe('DELETE /admin/api/users/:id', () => {
  it('self delete → 403 INSUFFICIENT_PRIVILEGE', async () => {
    const actingUserId = 'self-user-id'
    const db: DbMock = { execute: vi.fn() }
    const app = buildApp(db, actingUserId)

    const res = await app.request(`/admin/api/users/${actingUserId}`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INSUFFICIENT_PRIVILEGE')
    expect(db.execute).not.toHaveBeenCalled()
  })
})
