import type { MiddlewareHandler } from 'hono'
import type { Permission } from '@bobbykim/manguito-cms-core'
import type { RolesRegistry } from '../auth/registry.js'

type AuthUser = { role: string }

export function createPermissionMiddleware(registry: RolesRegistry) {
  return function requirePermission(permission: Permission): MiddlewareHandler {
    return async (c, next) => {
      const user = c.get('user') as AuthUser | undefined
      const role = user ? registry[user.role] : undefined

      if (!role || !role.permissions.includes(permission)) {
        return c.json(
          {
            ok: false,
            error: { code: 'INSUFFICIENT_PERMISSION', message: 'Insufficient permission' },
          },
          403,
        )
      }

      await next()
    }
  }
}
