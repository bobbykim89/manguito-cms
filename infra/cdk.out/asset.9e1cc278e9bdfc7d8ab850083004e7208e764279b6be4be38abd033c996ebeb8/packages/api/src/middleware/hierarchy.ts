import type { MiddlewareHandler } from 'hono'
import type { RolesRegistry } from '../auth/registry.js'

type AuthUser = { role: string }

export function createHierarchyMiddleware(
  registry: RolesRegistry,
  getUserRole: (id: string) => Promise<string | null>,
) {
  return function requireHierarchy(): MiddlewareHandler {
    return async (c, next) => {
      const user = c.get('user') as AuthUser | undefined
      const actingRole = user ? registry[user.role] : undefined

      if (!actingRole) {
        return c.json(
          {
            ok: false,
            error: { code: 'INSUFFICIENT_PRIVILEGE', message: 'Insufficient privilege' },
          },
          403,
        )
      }

      const method = c.req.method
      const targetId = c.req.param('id') as string | undefined

      let targetRoleName: string | null = null

      if (method === 'POST' && !targetId) {
        // POST /admin/api/users — create; role must be in request body
        let body: { role?: unknown } = {}
        try {
          body = await c.req.json<{ role?: unknown }>()
        } catch {
          // malformed body — role is absent, treated as INVALID_ROLE below
        }
        targetRoleName = typeof body.role === 'string' ? body.role : null
        if (!targetRoleName) {
          return c.json(
            {
              ok: false,
              error: { code: 'INVALID_ROLE', message: 'Request body must include a valid role' },
            },
            400,
          )
        }
      } else if (method === 'PATCH' && targetId) {
        // PATCH /admin/api/users/:id — update; role from body if present, else from DB
        let bodyRole: string | undefined
        try {
          const body = await c.req.json<{ role?: unknown }>()
          if (typeof body.role === 'string') bodyRole = body.role
        } catch {
          // no JSON body — fall through to DB lookup
        }
        targetRoleName = bodyRole ?? (await getUserRole(targetId))
      } else if (targetId) {
        // DELETE /admin/api/users/:id or POST /admin/api/users/:id/reset-password
        targetRoleName = await getUserRole(targetId)
      }

      // Target user not found — let the route handler return 404
      if (targetRoleName === null) {
        return next()
      }

      const targetRole = registry[targetRoleName]
      if (!targetRole) {
        return c.json(
          {
            ok: false,
            error: { code: 'INVALID_ROLE', message: `Role "${targetRoleName}" is not valid` },
          },
          400,
        )
      }

      if (actingRole.hierarchy_level >= targetRole.hierarchy_level) {
        return c.json(
          {
            ok: false,
            error: { code: 'INSUFFICIENT_PRIVILEGE', message: 'Insufficient privilege' },
          },
          403,
        )
      }

      await next()
    }
  }
}
