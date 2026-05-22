import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { RolesRegistry } from '../../auth/registry.js'

// ─── Version ──────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'

const _require = createRequire(__filename)

function readApiVersion(): string {
  for (const path of ['../package.json', '../../../package.json']) {
    try {
      const pkg = _require(path) as { name?: string; version?: string }
      if (pkg.name === '@bobbykim/manguito-cms-api' && typeof pkg.version === 'string') {
        return pkg.version
      }
    } catch {
      // not found at this path — try next
    }
  }
  return '0.0.0'
}

const API_VERSION = readApiVersion()

// ─── Types ────────────────────────────────────────────────────────────────────

type ActingUser = { id: string; role: string }

type ConfigOptions = {
  name: string
  maxFileSize?: number
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

    const roles = Object.values(registry)
      .filter((r) => r.name !== 'admin' && r.hierarchy_level > actingLevel)
      .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
      .map((r) => ({ name: r.name, label: r.label, hierarchy_level: r.hierarchy_level }))

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
        user: {
          id: actingUser.id,
          email: userRow?.email ?? '',
          role: actingUser.role,
          must_change_password: userRow?.must_change_password ?? false,
        },
        media: {
          max_file_size: config.maxFileSize ?? null,
        },
      },
    })
  })
}
