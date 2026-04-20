// TODO: implement in Phase 6 — JWT validation, token_version check
import type { MiddlewareHandler } from 'hono'

export const requireAuth: MiddlewareHandler = async (_c, next) => {
  return next()
}

export function requirePermission(_permission: string): MiddlewareHandler {
  return async (_c, next) => {
    return next()
  }
}
