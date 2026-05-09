import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import type { StorageAdapter, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { createCorsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { mustChangePasswordCheck } from './middleware/must-change-password.js'
import { createPermissionMiddleware } from './middleware/permission.js'
import { createHierarchyMiddleware } from './middleware/hierarchy.js'
import { createRateLimitMiddleware } from './middleware/rate-limit.js'
import { buildRolesRegistry } from './auth/registry.js'
import { registerPublicContentRoutes } from './routes/content.js'
import { registerPublicMediaRoutes } from './routes/media.js'
import { registerAdminContentRoutes } from './routes/admin/content.js'
import { registerAdminMediaRoutes } from './routes/admin/media.js'
import { registerAuthRoutes } from './routes/admin/auth.js'
import { registerUserRoutes } from './routes/admin/users.js'
import { registerConfigRoute } from './routes/admin/config.js'
import { registerSchemaRoute } from './routes/admin/schema.js'
import { createDrizzleContentRepository } from './repositories/content.js'
import { createMediaRepository } from './repositories/media.js'

export type CreateAPIAdapterOptions = {
  /** CMS display name shown in GET /admin/api/config. Defaults to 'Manguito CMS'. */
  name?: string
  prefix?: string
  storage: StorageAdapter
  registry: SchemaRegistry
  db: DrizzlePostgresInstance
  rateLimit?: {
    findAll?: {
      windowMs?: number
      maxPerIp?: number
      maxGlobal?: number
    }
  }
}

export interface ManguitoCmsAPIAdapter {
  readonly prefix: string
  readonly app: Hono
}

const MISSING_STORAGE_ERROR = `✗ api.storage is required but not configured.
  Add a storage adapter to your manguito.config.ts:

  api: createAPIAdapter({
    storage: createLocalAdapter(),   // dev
    // storage: createS3Adapter({ bucket: '...', region: '...' })  // production
  })

Exiting.`

export function createAPIAdapter(options: CreateAPIAdapterOptions): ManguitoCmsAPIAdapter {
  if (!options.storage) {
    throw new Error(MISSING_STORAGE_ERROR)
  }

  const prefix = options.prefix ?? '/api'
  const { storage, registry, db, rateLimit } = options
  const cmsName = options.name ?? 'Manguito CMS'

  // Build roles registry — throws immediately if roles are missing or invalid.
  // The server must not start with a broken registry.
  const rolesRegistry = buildRolesRegistry(registry.roles.roles)

  const app = new Hono()

  // CORS for all routes
  app.use('*', createCorsMiddleware({ origin: '*', enabled: true }))
  app.onError(errorHandler)

  // Rate limiter scoped to public API routes only
  app.use(
    '/api/*',
    createRateLimitMiddleware({
      windowMs: rateLimit?.findAll?.windowMs ?? 60_000,
      maxPerIp: rateLimit?.findAll?.maxPerIp ?? 30,
      maxGlobal: rateLimit?.findAll?.maxGlobal ?? 500,
    })
  )

  // ── Middleware factories — all close over rolesRegistry built once at startup ──

  const authMiddleware = createAuthMiddleware(db)
  const requirePermission = createPermissionMiddleware(rolesRegistry)

  const getUserRole = async (userId: string): Promise<string | null> => {
    const result = await db.execute(
      sql`SELECT r.name AS role
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.id = ${userId}
          LIMIT 1`
    )
    return (result.rows[0] as { role: string } | undefined)?.role ?? null
  }

  const requireHierarchy = createHierarchyMiddleware(rolesRegistry, getUserRole)

  // ── Repositories ──────────────────────────────────────────────────────────────

  const contentRepos = Object.fromEntries(
    Object.entries(registry.content_types).map(([typeName, ct]) => [
      typeName,
      createDrizzleContentRepository(db, ct.db.table_name),
    ])
  )
  const taxonomyRepos = Object.fromEntries(
    Object.entries(registry.taxonomy_types).map(([typeName, tt]) => [
      typeName,
      createDrizzleContentRepository(db, tt.db.table_name),
    ])
  )
  const repos = { ...contentRepos, ...taxonomyRepos }
  const mediaRepo = createMediaRepository(db)

  // ── Auth routes registered directly on app BEFORE the blanket use() calls ───────
  //
  // registerAuthRoutes uses full paths (/admin/api/auth/login etc.). Mounting via
  // app.route('/admin/api/auth', subRouter) would strip that prefix and make the
  // routes unreachable, so we register directly on app.
  //
  // In Hono, handlers registered before a use() call are reached first. A route
  // handler that returns a Response does not call next(), so the blanket
  // authMiddleware registered below never runs for matched auth paths.
  registerAuthRoutes(app, db)

  // ── Blanket middleware for all /admin/api/* (registered after auth routes) ─────
  app.use('/admin/api/*', authMiddleware)
  app.use('/admin/api/*', mustChangePasswordCheck)

  // ── OpenAPI spec endpoints ────────────────────────────────────────────────────

  app.get('/api/openapi.json', (c) =>
    c.json({
      openapi: '3.0.3',
      info: { title: 'Manguito CMS Public API', version: '1.0.0' },
      paths: {},
    })
  )
  // Admin spec — auth covered by the blanket use() above
  app.get('/admin/api/openapi.json', (c) =>
    c.json({
      openapi: '3.0.3',
      info: { title: 'Manguito CMS Admin API', version: '1.0.0' },
      paths: {},
    })
  )

  // ── Public routes ─────────────────────────────────────────────────────────────

  registerPublicContentRoutes(app, registry, repos)
  registerPublicMediaRoutes(app, mediaRepo)

  // ── Admin routes — all registered AFTER the blanket use() so auth middleware
  //    runs before every handler. registerConfigRoute is called first so its
  //    GET /admin/api/config handler wins over the stale stub in content.ts.
  registerConfigRoute(app, { name: cmsName }, rolesRegistry)
  registerSchemaRoute(app, registry)
  registerUserRoutes(app, db, requirePermission, requireHierarchy)
  registerAdminContentRoutes(app, registry, repos, mediaRepo)
  registerAdminMediaRoutes(app, mediaRepo, storage)

  return { prefix, app }
}
