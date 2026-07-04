import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { RolesRegistry } from '../../auth/registry.js'

// ─── Version — injected by tsup at build time; falls back in test/dev ─────────

declare const __API_VERSION__: string

const API_VERSION: string = (() => {
  try { return __API_VERSION__ } catch { return '0.0.0' }
})()

// ─── Types ────────────────────────────────────────────────────────────────────

type ActingUser = { id: string; role: string }

type ConfigOptions = {
  name: string
  maxFileSize?: number
  presignedUploads?: boolean
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerConfigRoute(
  app: Hono,
  config: ConfigOptions,
  registry: RolesRegistry,
  db: DrizzlePostgresInstance,
): void {
  app.get('/admin/api/config', async (c) => {
    const actingUser = (c as unknown as { get(k: 'user'): ActingUser }).get('user')
    const actingRole = registry[actingUser.role]
    const actingLevel = actingRole?.hierarchy_level ?? Infinity

    // Subordinate roles only — used by user management forms for role assignment.
    const roles = Object.values(registry)
      .filter((r) => r.name !== 'admin' && r.hierarchy_level > actingLevel)
      .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
      .map((r) => ({ name: r.name, label: r.label, hierarchy_level: r.hierarchy_level }))

    // All roles with full data — used by the admin panel to resolve permissions.
    const all_roles = Object.values(registry)
      .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
      .map((r) => ({
        name: r.name,
        label: r.label,
        hierarchy_level: r.hierarchy_level,
        is_system: r.is_system,
        permissions: r.permissions,
      }))

    const userResult = await db.execute(
      sql`SELECT email, must_change_password FROM users WHERE id = ${actingUser.id} LIMIT 1`
    )
    const userRow = userResult.rows[0] as
      | { email: string; must_change_password: boolean }
      | undefined

    return c.json({
      ok: true,
      data: {
        cms_name: config.name ?? 'Manguito CMS',
        version: API_VERSION,
        roles,
        all_roles,
        user: {
          id: actingUser.id,
          email: userRow?.email ?? '',
          role: actingUser.role,
          must_change_password: userRow?.must_change_password ?? false,
        },
        media: {
          max_file_size: config.maxFileSize ?? null,
          presigned_uploads: config.presignedUploads ?? false,
        },
      },
    })
  })
}
