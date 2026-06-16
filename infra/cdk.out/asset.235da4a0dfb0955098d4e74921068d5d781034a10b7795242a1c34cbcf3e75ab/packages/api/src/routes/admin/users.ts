import type { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import type { createPermissionMiddleware } from '../../middleware/permission.js'
import type { createHierarchyMiddleware } from '../../middleware/hierarchy.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActingUser = { id: string; role: string }

type UserRow = {
  id: string
  email: string
  role: string
  must_change_password: boolean
  created_at: string
  updated_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActingUser(c: unknown): ActingUser {
  return (c as { get(k: 'user'): ActingUser }).get('user')
}

function generateTempPassword(): string {
  return randomBytes(8).toString('base64url')
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerUserRoutes(
  app: Hono,
  db: DrizzlePostgresInstance,
  requirePermission: ReturnType<typeof createPermissionMiddleware>,
  requireHierarchy: ReturnType<typeof createHierarchyMiddleware>,
): void {
  // POST /admin/api/users/change-password
  // Registered first — exempt from mustChangePasswordCheck (enforced by path check in that middleware).
  // No requirePermission — available to any authenticated user.
  app.post('/admin/api/users/change-password', async (c) => {
    const actingUser = getActingUser(c)

    let body: { current_password?: unknown; new_password?: unknown }
    try {
      body = (await c.req.json()) as { current_password?: unknown; new_password?: unknown }
    } catch {
      return c.json(
        { ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' } },
        401,
      )
    }

    const currentPassword =
      typeof body.current_password === 'string' ? body.current_password : null
    const newPassword = typeof body.new_password === 'string' ? body.new_password : null

    if (!currentPassword || !newPassword) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'current_password and new_password are required.',
          },
        },
        422,
      )
    }

    const hashResult = await db.execute(
      sql`SELECT password_hash FROM users WHERE id = ${actingUser.id} LIMIT 1`,
    )
    const hashRow = hashResult.rows[0] as { password_hash: string } | undefined

    if (!hashRow || !(await verifyPassword(currentPassword, hashRow.password_hash))) {
      return c.json(
        { ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' } },
        401,
      )
    }

    const newHash = await hashPassword(newPassword)

    await db.execute(
      sql`UPDATE users
          SET password_hash       = ${newHash},
              must_change_password = false,
              token_version        = token_version + 1,
              updated_at           = NOW()
          WHERE id = ${actingUser.id}`,
    )

    return c.json({ ok: true })
  })

  // GET /admin/api/users
  app.get('/admin/api/users', requirePermission('users:read'), async (c) => {
    const result = await db.execute(
      sql`SELECT u.id, u.email, r.name AS role, u.must_change_password,
                 u.created_at, u.updated_at
          FROM users u
          JOIN roles r ON r.id = u.role_id
          ORDER BY u.created_at ASC`,
    )

    return c.json({ ok: true, data: result.rows as UserRow[] })
  })

  // GET /admin/api/users/:id
  app.get('/admin/api/users/:id', requirePermission('users:read'), async (c) => {
    const id = c.req.param('id')

    const result = await db.execute(
      sql`SELECT u.id, u.email, r.name AS role, u.must_change_password,
                 u.created_at, u.updated_at
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.id = ${id}
          LIMIT 1`,
    )
    const row = result.rows[0] as UserRow | undefined

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } },
        404,
      )
    }

    return c.json({ ok: true, data: row })
  })

  // POST /admin/api/users
  app.post(
    '/admin/api/users',
    requirePermission('users:create'),
    requireHierarchy(),
    async (c) => {
      let body: { email?: unknown; role?: unknown }
      try {
        body = (await c.req.json()) as { email?: unknown; role?: unknown }
      } catch {
        return c.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Request body is required.' } },
          422,
        )
      }

      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
      const roleName = typeof body.role === 'string' ? body.role : null

      if (!email) {
        return c.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: 'email is required.' } },
          422,
        )
      }
      if (!roleName) {
        return c.json(
          { ok: false, error: { code: 'INVALID_ROLE', message: 'role is required.' } },
          400,
        )
      }

      const roleResult = await db.execute(
        sql`SELECT id FROM roles WHERE name = ${roleName} LIMIT 1`,
      )
      const roleRow = roleResult.rows[0] as { id: string } | undefined

      if (!roleRow) {
        return c.json(
          {
            ok: false,
            error: { code: 'INVALID_ROLE', message: `Role "${roleName}" does not exist.` },
          },
          400,
        )
      }

      const tempPassword = generateTempPassword()
      const passwordHash = await hashPassword(tempPassword)

      const insertResult = await db.execute(
        sql`INSERT INTO users
              (id, email, password_hash, role_id, must_change_password, token_version,
               created_at, updated_at)
            VALUES
              (gen_random_uuid(), ${email}, ${passwordHash}, ${roleRow.id},
               true, 0, NOW(), NOW())
            RETURNING id, email, must_change_password, created_at, updated_at`,
      )
      const newUser = insertResult.rows[0] as
        | {
            id: string
            email: string
            must_change_password: boolean
            created_at: string
            updated_at: string
          }
        | undefined

      if (!newUser) {
        return c.json(
          { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create user.' } },
          500,
        )
      }

      return c.json(
        {
          ok: true,
          data: {
            id: newUser.id,
            email: newUser.email,
            role: roleName,
            must_change_password: newUser.must_change_password,
            temporary_password: tempPassword,
            created_at: newUser.created_at,
            updated_at: newUser.updated_at,
          },
        },
        201,
      )
    },
  )

  // PATCH /admin/api/users/:id
  app.patch(
    '/admin/api/users/:id',
    requirePermission('users:edit'),
    requireHierarchy(),
    async (c) => {
      const id = c.req.param('id')
      const actingUser = getActingUser(c)

      let body: { email?: unknown; role?: unknown }
      try {
        body = (await c.req.json()) as { email?: unknown; role?: unknown }
      } catch {
        body = {}
      }

      // Self role change is never permitted
      if (actingUser.id === id && body.role !== undefined) {
        return c.json(
          {
            ok: false,
            error: { code: 'INSUFFICIENT_PRIVILEGE', message: 'You cannot change your own role.' },
          },
          403,
        )
      }

      const existingResult = await db.execute(
        sql`SELECT id, email, role_id FROM users WHERE id = ${id} LIMIT 1`,
      )
      const existing = existingResult.rows[0] as
        | { id: string; email: string; role_id: string }
        | undefined

      if (!existing) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } },
          404,
        )
      }

      const newEmail =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : existing.email

      let newRoleId = existing.role_id
      let changeRole = false

      if (typeof body.role === 'string' && body.role) {
        const roleResult = await db.execute(
          sql`SELECT id FROM roles WHERE name = ${body.role} LIMIT 1`,
        )
        const roleRow = roleResult.rows[0] as { id: string } | undefined

        if (!roleRow) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_ROLE',
                message: `Role "${body.role}" does not exist.`,
              },
            },
            400,
          )
        }

        newRoleId = roleRow.id
        changeRole = true
      }

      if (changeRole) {
        await db.execute(
          sql`UPDATE users
              SET email         = ${newEmail},
                  role_id       = ${newRoleId},
                  token_version = token_version + 1,
                  updated_at    = NOW()
              WHERE id = ${id}`,
        )
      } else {
        await db.execute(
          sql`UPDATE users
              SET email      = ${newEmail},
                  role_id    = ${newRoleId},
                  updated_at = NOW()
              WHERE id = ${id}`,
        )
      }

      const updatedResult = await db.execute(
        sql`SELECT u.id, u.email, r.name AS role, u.must_change_password,
                   u.created_at, u.updated_at
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = ${id}
            LIMIT 1`,
      )
      const updated = updatedResult.rows[0] as UserRow | undefined

      if (!updated) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } },
          404,
        )
      }

      return c.json({ ok: true, data: updated })
    },
  )

  // DELETE /admin/api/users/:id
  app.delete(
    '/admin/api/users/:id',
    requirePermission('users:delete'),
    requireHierarchy(),
    async (c) => {
      const id = c.req.param('id')
      const actingUser = getActingUser(c)

      if (actingUser.id === id) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'INSUFFICIENT_PRIVILEGE',
              message: 'You cannot delete your own account.',
            },
          },
          403,
        )
      }

      const result = await db.execute(
        sql`DELETE FROM users WHERE id = ${id} RETURNING id`,
      )

      if ((result.rows as unknown[]).length === 0) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } },
          404,
        )
      }

      return c.json({ ok: true })
    },
  )

  // POST /admin/api/users/:id/reset-password
  app.post(
    '/admin/api/users/:id/reset-password',
    requirePermission('users:edit'),
    requireHierarchy(),
    async (c) => {
      const id = c.req.param('id')
      const actingUser = getActingUser(c)

      if (actingUser.id === id) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'INSUFFICIENT_PRIVILEGE',
              message: 'You cannot reset your own password via this endpoint.',
            },
          },
          403,
        )
      }

      const existingResult = await db.execute(
        sql`SELECT id FROM users WHERE id = ${id} LIMIT 1`,
      )
      const existing = existingResult.rows[0] as { id: string } | undefined

      if (!existing) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } },
          404,
        )
      }

      const tempPassword = generateTempPassword()
      const passwordHash = await hashPassword(tempPassword)

      await db.execute(
        sql`UPDATE users
            SET password_hash        = ${passwordHash},
                must_change_password = true,
                token_version        = token_version + 1,
                updated_at           = NOW()
            WHERE id = ${id}`,
      )

      return c.json({ ok: true, data: { temporary_password: tempPassword } })
    },
  )
}
