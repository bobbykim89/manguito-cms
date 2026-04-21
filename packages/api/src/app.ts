import { Hono } from 'hono'
import type {
  StorageAdapter,
  SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { createCorsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error.js'
import { requireAuth } from './middleware/auth.js'
import { createRateLimitMiddleware } from './middleware/rate-limit.js'
import { registerPublicContentRoutes } from './routes/content.js'
import { registerPublicMediaRoutes } from './routes/media.js'
import { registerAdminContentRoutes } from './routes/admin/content.js'
import { registerAdminMediaRoutes } from './routes/admin/media.js'
import { createDrizzleContentRepository } from './repositories/content.js'
import { createMediaRepository } from './repositories/media.js'

export type CreateAPIAdapterOptions = {
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

  const app = new Hono()

  // CORS for all routes
  app.use('*', createCorsMiddleware({ origin: '*', enabled: true }))
  app.onError(errorHandler)

  // Auth middleware placeholder — runs before rate limiter so authenticated requests are exempt.
  // Phase 6 will replace this with real JWT validation + token_version check.
  app.use('*', requireAuth)

  // Rate limiter scoped to public API routes — authenticated requests (auth_token cookie) are exempt.
  // Applied after auth middleware per the rate-limiting decision doc.
  app.use(
    '/api/*',
    createRateLimitMiddleware({
      windowMs: rateLimit?.findAll?.windowMs ?? 60_000,
      maxPerIp: rateLimit?.findAll?.maxPerIp ?? 30,
      maxGlobal: rateLimit?.findAll?.maxGlobal ?? 500,
    })
  )

  // Build repositories from schema + db — api never imports DrizzleContentRepository directly
  const contentRepos = Object.fromEntries(
    Object.entries(registry.content_types).map(([name, ct]) => [
      name,
      createDrizzleContentRepository(db, ct.db.table_name),
    ])
  )
  const taxonomyRepos = Object.fromEntries(
    Object.entries(registry.taxonomy_types).map(([name, tt]) => [
      name,
      createDrizzleContentRepository(db, tt.db.table_name),
    ])
  )
  const repos = { ...contentRepos, ...taxonomyRepos }
  const mediaRepo = createMediaRepository(db)

  // OpenAPI spec endpoints wired here — not inside route helpers to avoid duplication
  app.get('/api/openapi.json', (c) =>
    c.json({
      openapi: '3.0.3',
      info: { title: 'Manguito CMS Public API', version: '1.0.0' },
      paths: {},
    })
  )
  app.get('/admin/api/openapi.json', requireAuth, (c) =>
    c.json({
      openapi: '3.0.3',
      info: { title: 'Manguito CMS Admin API', version: '1.0.0' },
      paths: {},
    })
  )

  registerPublicContentRoutes(app, registry, repos)
  registerPublicMediaRoutes(app, mediaRepo)
  registerAdminContentRoutes(app, registry, repos, mediaRepo)
  registerAdminMediaRoutes(app, mediaRepo, storage)

  return { prefix, app }
}
