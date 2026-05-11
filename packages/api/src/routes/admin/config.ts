import type { Hono } from 'hono'
import { createRequire } from 'node:module'
import type { RolesRegistry } from '../../auth/registry.js'

// ─── Version ──────────────────────────────────────────────────────────────────

const _require = createRequire(__filename)

function readApiVersion(): string {
  // Two candidate paths cover the main execution contexts:
  //   '../package.json'       — from dist/index.cjs (tsup CJS bundle, one up from dist/)
  //   '../../../package.json' — from src/routes/admin/config.ts (tsx / tests)
  // The name check ensures we found the right package.json in both cases.
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

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerConfigRoute(
  app: Hono,
  config: { name: string },
  registry: RolesRegistry,
): void {
  app.get('/admin/api/config', (c) => {
    const actingUser = (c as unknown as { get(k: 'user'): ActingUser }).get('user')
    const actingRole = registry[actingUser.role]
    const actingLevel = actingRole?.hierarchy_level ?? Infinity

    const roles = Object.values(registry)
      .filter((r) => r.name !== 'admin' && r.hierarchy_level > actingLevel)
      .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
      .map((r) => ({ name: r.name, label: r.label, hierarchy_level: r.hierarchy_level }))

    return c.json({
      ok: true,
      data: {
        cms_name: config.name ?? 'Manguito CMS',
        version: API_VERSION,
        roles,
      },
    })
  })
}
