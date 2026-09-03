import { Hono } from 'hono'
import type { Handler, MiddlewareHandler } from 'hono'
import { sql } from 'drizzle-orm'
import type { StorageAdapter, SchemaRegistry, ParsedContentType, ParsedTaxonomyType, ParsedParagraphType, ResolvedRateLimitConfig, CorsConfig, ResolvedGraphQLConfig } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { createCorsMiddleware } from './middleware/cors.js'
import { createSecurityHeadersMiddleware } from './middleware/security-headers.js'
import { errorHandler } from './middleware/error.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { mustChangePasswordCheck } from './middleware/must-change-password.js'
import { createPermissionMiddleware } from './middleware/permission.js'
import { createHierarchyMiddleware } from './middleware/hierarchy.js'
import { resolveListRateLimit } from './middleware/rate-limit.js'
import { buildRolesRegistry } from './auth/registry.js'
import { createProgrammaticResolver, validateResolverBindings, type ResolverMap } from './programmatic/resolve.js'
import { registerPublicContentRoutes } from './routes/content.js'
import { registerPublicMediaRoutes } from './routes/media.js'
import { registerAdminContentRoutes } from './routes/admin/content.js'
import { registerAdminMediaRoutes } from './routes/admin/media.js'
import { registerAuthRoutes } from './routes/admin/auth.js'
import { registerUserRoutes } from './routes/admin/users.js'
import { registerConfigRoute } from './routes/admin/config.js'
import { registerSchemaRoute } from './routes/admin/schema.js'
import { createDrizzleContentRepository } from './repositories/content.js'
import { buildRelationsMap } from './relations.js'
import { createMediaRepository } from './repositories/media.js'
import { createFieldKeyMap, type FieldKeyMap } from './field-keys.js'
import { SORTABLE_FIELDS } from './routes/query-params.js'
import { buildProjectors, type Projectors } from './projector.js'
import { normalizePrefix, createPublicPaths, createVersionedPaths, type VersionedPaths } from './paths.js'
import { buildVersionSurface, classifyVersion, deprecationHeaders, type BakedVersionModel } from './versions.js'

export type CreateCmsAppOptions = {
  /** CMS display name shown in GET /admin/api/config. Defaults to 'Manguito CMS'. */
  name?: string
  prefix?: string
  storage: StorageAdapter
  registry: SchemaRegistry
  db: DrizzlePostgresInstance
  media?: {
    /** Optional upload size cap in bytes. Returned by GET /admin/api/config for client-side UX validation. */
    max_file_size?: number
  }
  rateLimit?: ResolvedRateLimitConfig
  cors?: CorsConfig
  /** Programmatic field resolvers, keyed `${schema}::${field}`. */
  resolvers?: ResolverMap
  /** GraphQL module config (resolved). When enabled, mounts POST /graphql. */
  graphql?: ResolvedGraphQLConfig
  /**
   * The baked version model — what `manguito build` writes into
   * .manguito/version-model.ts. When absent, the app behaves exactly as it
   * did before versioning existed: one unversioned pass at the current
   * schema, no version routes, no deprecation headers, no catch-all.
   */
  versions?: BakedVersionModel
}

export interface ManguitoCmsAPIAdapter {
  readonly prefix: string
  readonly app: Hono
}

/**
 * Every exact route path one version's public surface registers — the two
 * meta-list endpoints, one entry per content type (its collection, plus its
 * item route unless `only_one`), and a collection/item pair per taxonomy
 * type. Mirrors `registerPublicContentRoutes`' own enumeration exactly,
 * because the deprecation-header middleware must attach to precisely these
 * paths — never a `${prefix}/*` wildcard, which would also catch
 * `/api/media` where "pin a version" is meaningless.
 */
function versionRoutePaths(registry: SchemaRegistry, paths: VersionedPaths): string[] {
  const out: string[] = [paths.collection('content'), paths.collection('taxonomy')]
  for (const ct of Object.values(registry.content_types) as ParsedContentType[]) {
    out.push(paths.collection(ct.default_base_path))
    if (!ct.only_one) out.push(paths.item(ct.default_base_path))
  }
  for (const tt of Object.values(registry.taxonomy_types) as ParsedTaxonomyType[]) {
    out.push(paths.taxonomyCollection(tt.name), paths.taxonomyItem(tt.name))
  }
  return out
}

const MISSING_STORAGE_ERROR = `✗ api.storage is required but not configured.
  Add a storage adapter to your manguito.config.ts:

  api: createAPIAdapter({
    storage: createLocalAdapter(),   // dev
    // storage: createS3Adapter({ bucket: '...', region: '...' })  // production
  })

Exiting.`

export function createCmsApp(options: CreateCmsAppOptions): ManguitoCmsAPIAdapter {
  if (!options.storage) {
    throw new Error(MISSING_STORAGE_ERROR)
  }

  const prefix = normalizePrefix(options.prefix)
  const publicPaths = createPublicPaths(prefix)
  // Unversioned paths — used only to document the OpenAPI spec below, which
  // always describes the current schema's own shape regardless of how many
  // versions are live. The actual public routes are registered per version
  // further down (one pass per live version, plus one unversioned pass).
  const versionedPaths = createVersionedPaths(prefix, null)
  const { storage, registry, db, rateLimit, media, cors } = options
  const cmsName = options.name ?? 'Manguito CMS'
  const maxFileSize = media?.max_file_size

  // Build roles registry — throws immediately if roles are missing or invalid.
  // The server must not start with a broken registry.
  const rolesRegistry = buildRolesRegistry(registry.roles.roles)

  // Validate programmatic-field bindings at startup (throws on mismatch, like
  // the storage/roles checks above). Undefined resolvers ⇒ empty map.
  const resolverMap = options.resolvers ?? new Map()
  validateResolverBindings(registry, resolverMap)
  const programmaticResolver = createProgrammaticResolver(resolverMap)

  const app = new Hono()

  // Security headers for all routes — registered before CORS so normal and
  // CORS-handled responses carry the conservative defaults. Responses produced
  // by app.onError (thrown errors) bypass this middleware's post-next step;
  // those are JSON error envelopes with no clickjacking/XSS surface. CSP
  // connect-src is derived from the storage adapter: presigned uploads go
  // browser→storage directly, so that host must be allowlisted.
  // The GraphiQL explorer (dev-only by default) boots from a CDN bundle plus
  // inline scripts, which the strict script-src blocks — so when it is enabled
  // the /graphql path alone gets a relaxed CSP (ADR api/0010).
  const uploadOrigins = storage.getUploadOrigins?.() ?? []
  const graphiqlEnabled = options.graphql?.enabled === true && options.graphql.graphiql === true
  app.use(
    '*',
    createSecurityHeadersMiddleware({
      connectSrc: uploadOrigins,
      ...(graphiqlEnabled && { graphiqlPath: '/graphql' }),
    }),
  )

  // CORS for all routes
  app.use('*', createCorsMiddleware(cors ?? { origin: '*', enabled: true }))
  app.onError(errorHandler)

  // Rate limiter for public list endpoints — threaded into route registrators,
  // applied only to paginated collection routes (not single-item lookups).
  // `undefined` when disabled via rateLimit.findAll === '*'.
  const listRateLimit = resolveListRateLimit(rateLimit)

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

  // ── Field key maps ──────────────────────────────────────────────────────────
  //
  // One per content, taxonomy AND paragraph type, built once at startup, keyed
  // by machine name. Throws on a label / column collision — the server must not
  // boot with an ambiguous mapping.
  //
  // Paragraph types belong in the same object as the other two, not a sidecar:
  // both consumers index it by machine name over a key space that includes
  // them. `buildProjectors` walks `registry.paragraph_types` to project
  // paragraph children, and `graphql/schema.ts`'s `buildObjectType` runs over
  // paragraph types too — so a programmatic field on a paragraph type needs its
  // map here to be handed a label-keyed record, exactly like one on a content
  // type. Every other GraphQL field resolves per field by column and is
  // indifferent to this map.
  const fieldKeyMaps: Record<string, FieldKeyMap> = Object.fromEntries([
    ...Object.entries(registry.content_types).map(([typeName, ct]) => [
      typeName,
      createFieldKeyMap((ct as ParsedContentType).fields),
    ]),
    ...Object.entries(registry.taxonomy_types).map(([typeName, tt]) => [
      typeName,
      createFieldKeyMap((tt as ParsedTaxonomyType).fields),
    ]),
    ...Object.entries(registry.paragraph_types).map(([typeName, pt]) => [
      typeName,
      createFieldKeyMap((pt as ParsedParagraphType).fields),
    ]),
  ])

  // Recursive outbound projection. Every read response is projected through
  // this rather than through a bare toLabels.
  const projectors: Projectors = buildProjectors(registry, fieldKeyMaps)

  // Maps SORTABLE_FIELDS' labels to this type's storage columns, so the
  // repository can validate sort_by against columns once the route has mapped
  // it. Identity for a schema where no field declares its own `column:` — but
  // a field can already declare one (this branch's own fixtures rely on it),
  // so this map can diverge even without schema versioning being involved.
  //
  // A label absent from this map is EXCLUDED, not passed through as a bogus
  // literal: `columnFor` only returns undefined for a label this type has no
  // field for at all (SORTABLE_FIELDS is shared across every type), or a
  // system field (id/slug/created_at/...), which is not part of the
  // field-key map but is still legitimately sortable — its column IS its own
  // name. Anything else unresolved has no business in the repository's
  // sortable-columns allow-set. Mirrors versions.ts's per-version copy of
  // this same function exactly — kept duplicated rather than shared, since
  // this one always reads the top-level (current-only) `fieldKeyMaps`.
  const sortableColumnsFor = (typeName: string): Set<string> => {
    const map = fieldKeyMaps[typeName]!
    const type = registry.content_types[typeName] ?? registry.taxonomy_types[typeName]
    const systemFieldNames = new Set((type?.system_fields ?? []).map((f) => f.name))
    const out = new Set<string>()
    for (const label of SORTABLE_FIELDS) {
      const column = map.columnFor(label)
      if (column !== undefined) out.add(column)
      else if (systemFieldNames.has(label)) out.add(label)
    }
    return out
  }

  // ── Repositories ──────────────────────────────────────────────────────────────

  const contentRepos = Object.fromEntries(
    Object.entries(registry.content_types).map(([typeName, ct]) => [
      typeName,
      createDrizzleContentRepository(db, (ct as ParsedContentType).db.table_name, {
        sortableColumns: sortableColumnsFor(typeName),
      }),
    ])
  )
  const taxonomyRepos = Object.fromEntries(
    Object.entries(registry.taxonomy_types).map(([typeName, tt]) => [
      typeName,
      createDrizzleContentRepository(db, (tt as ParsedTaxonomyType).db.table_name, {
        sortableColumns: sortableColumnsFor(typeName),
      }),
    ])
  )
  const repos = { ...contentRepos, ...taxonomyRepos }
  const mediaRepo = createMediaRepository(db)

  // ── Public repo factory ──────────────────────────────────────────────────────
  //
  // Relation resolution (?include=, always-resolved media) is wired only for
  // the public read API. Admin routes reuse `repos` above and must keep
  // receiving raw foreign-key IDs back from findOne/update — the edit forms
  // (e.g. MediaUpload.vue) expect a plain ID string, not a resolved object.
  //
  // Passed as `makeRepo` into `buildVersionSurface` below — once per live
  // version, plus once more for the unversioned pass — so every version of
  // the public surface keeps this same relation-resolution distinction.
  // Relations are keyed by field name and derived from the registry's own
  // (current) fields, which describe STRUCTURE (foreign keys, junction
  // tables) rather than a version's exposed labels — nested/related content
  // follows current's shape on every version, by design, same as paragraph
  // fields (see versions.ts). Only the field-key mapping varies per version.
  const makeRepo = (typeName: string, tableName: string, sortableColumns: Set<string>) => {
    const type = registry.content_types[typeName] ?? registry.taxonomy_types[typeName]
    return createDrizzleContentRepository(db, tableName, {
      relations: buildRelationsMap(type!.fields, registry),
      publishedRelations: true,
      sortableColumns,
    })
  }

  // ── GraphQL repos ───────────────────────────────────────────────────────────
  //
  // GraphQL resolves relations lazily, per selected field, through its own
  // request-scoped dataloaders — so its repos must NOT resolve relations
  // eagerly. Reusing `publicRepos` here is actively wrong: their eager pass
  // overwrites a media field's column (the FK column and the field share a
  // name) with the resolved media object, and the dataloader then reads that
  // object back where a UUID is expected. It also pays for resolving every
  // relation on every query, including the ones the client never selected.
  //
  // These are still public reads: every GraphQL resolver passes
  // `published_only: true`, and the dataloaders filter relation targets by
  // published (ADR api/0002). Built separately from the admin `repos` so a
  // future change there can never silently widen the public surface.
  //
  // They do take `sortableColumns`, like every other repo here: the GraphQL
  // sort enum's `title` value is a schema field's LABEL, which
  // `collectionResolver` maps to a column before calling findMany.
  const graphqlRepos = Object.fromEntries([
    ...Object.entries(registry.content_types).map(([typeName, ct]) => [
      typeName,
      createDrizzleContentRepository(db, (ct as ParsedContentType).db.table_name, {
        sortableColumns: sortableColumnsFor(typeName),
      }),
    ]),
    ...Object.entries(registry.taxonomy_types).map(([typeName, tt]) => [
      typeName,
      createDrizzleContentRepository(db, (tt as ParsedTaxonomyType).db.table_name, {
        sortableColumns: sortableColumnsFor(typeName),
      }),
    ]),
  ])

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

  app.get(publicPaths.openapi(), (c) => {
    const paths: Record<string, unknown> = {}

    for (const ct of Object.values(registry.content_types) as ParsedContentType[]) {
      const base = ct.default_base_path
      if (ct.only_one) {
        paths[versionedPaths.collection(base)] = { get: { summary: `Get ${ct.label}`, tags: [ct.label] } }
      } else {
        paths[versionedPaths.collection(base)] = { get: { summary: `List published ${ct.label}`, tags: [ct.label] } }
        paths[versionedPaths.item(base).replace(':slug', '{slug}')] = {
          get: { summary: `Get ${ct.label} by slug`, tags: [ct.label] },
        }
      }
    }

    for (const tt of Object.values(registry.taxonomy_types) as ParsedTaxonomyType[]) {
      paths[versionedPaths.taxonomyCollection(tt.name)] = { get: { summary: `List published ${tt.label}`, tags: [tt.label] } }
      paths[versionedPaths.taxonomyItem(tt.name).replace(':id', '{id}')] = {
        get: { summary: `Get ${tt.label} by id`, tags: [tt.label] },
      }
    }

    paths[publicPaths.mediaCollection()] = { get: { summary: 'List media items', tags: ['Media'] } }
    paths[publicPaths.mediaItem().replace(':id', '{id}')] = { get: { summary: 'Get media item by id', tags: ['Media'] } }

    return c.json({
      openapi: '3.0.3',
      info: { title: 'Manguito CMS Public API', version: '1.0.0' },
      paths,
    })
  })
  // Admin spec — auth covered by the blanket use() above
  app.get('/admin/api/openapi.json', (c) =>
    c.json({
      openapi: '3.0.3',
      info: { title: 'Manguito CMS Admin API', version: '1.0.0' },
      paths: {},
    })
  )

  // ── Public routes ─────────────────────────────────────────────────────────────
  //
  // A project that never cut a version gets the identity model, so the
  // unversioned pass below is the only registration and behaviour is
  // unchanged from before versioning existed.
  const model: BakedVersionModel = options.versions ?? {
    current: 'v1',
    live: ['v1'],
    projections: {},
  }

  // One pass per live version, then one unversioned pass at the latest.
  const passes: Array<{ version: string | null; projectionVersion: string }> = [
    ...(options.versions !== undefined
      ? model.live.map((v) => ({ version: v, projectionVersion: v }))
      : []),
    { version: null, projectionVersion: model.current },
  ]

  for (const pass of passes) {
    const surface = buildVersionSurface({ ...pass, prefix, registry, model, makeRepo })
    const headers = deprecationHeaders({
      requested: pass.version,
      model,
      // The version root, with no trailing slash — never
      // createVersionedPaths(prefix, model.current).collection(''), which
      // would yield `${prefix}/${model.current}/` in every Link header.
      successor: `${prefix}/${model.current}`,
    })
    // Header middleware registers on this pass's exact paths — never a
    // ${prefix}/* wildcard, which would also catch /api/media where "pin a
    // version" is meaningless, and would need a guard kept in sync with the
    // catch-all's.
    if (headers !== null) {
      const attachDeprecationHeaders: MiddlewareHandler = async (c, next) => {
        await next()
        for (const [key, value] of Object.entries(headers)) c.res.headers.set(key, value)
      }
      for (const path of versionRoutePaths(registry, surface.paths)) {
        app.use(path, attachDeprecationHeaders)
      }
    }
    registerPublicContentRoutes(app, registry, surface.repos, surface.projectors, surface.paths, listRateLimit, programmaticResolver)
  }

  // Registered last. Only ever reached by a request that matched no live
  // version's routes. `not-a-version` falls through, which is what protects
  // /api/media/:id — order-independent rather than dependent on registration
  // sequence.
  //
  // That order-independence is specifically about a SEGMENT that merely
  // isn't version-shaped, like 'media'. A content type whose own
  // `default_base_path` happens to LOOK version-shaped (e.g. a base path of
  // 'v2') is protected by registration order instead: every pass above
  // (every live version's, plus the unversioned one) registers that type's
  // concrete routes before this catch-all is ever added, and Hono matches in
  // registration order — so a request for that path is already answered
  // long before `classifyVersion` would get a chance to misread its first
  // segment as a version number.
  if (options.versions !== undefined) {
    app.all(`${prefix}/:version/*`, async (c, next) => {
      const kind = classifyVersion(c.req.param('version'), model)
      if (kind === 'not-a-version' || kind === 'live') return next()
      const live = model.live.join(', ')
      return kind === 'retired'
        ? c.json(
            {
              ok: false,
              error: {
                code: 'VERSION_RETIRED',
                message: `Version ${c.req.param('version')} is no longer served. Live versions: ${live}.`,
              },
            },
            410
          )
        : c.json(
            {
              ok: false,
              error: {
                code: 'VERSION_NOT_FOUND',
                message: `No version ${c.req.param('version')} is served. Live versions: ${live}.`,
              },
            },
            404
          )
    })
  }

  registerPublicMediaRoutes(app, mediaRepo, publicPaths, listRateLimit)

  // ── GraphQL (opt-in) ──────────────────────────────────────────────────────────
  //
  // Loaded via a DYNAMIC import so `graphql`/`graphql-yoga` never load unless a
  // consumer opts in — the `.` entry (this file) must stay free of a static
  // dependency on the graphql/ subpath (ADR api/0006). The import kicks off
  // immediately (schema-building and Armor-plugin setup are synchronous once the
  // module is loaded; only the `import()` itself is async), and any request that
  // lands on /graphql before it resolves awaits the same in-flight promise —
  // there's a single shared `ready` promise, never a re-import per request.
  // Unauthenticated by design: it sits alongside /api/*, not behind the
  // /admin/api/* auth middleware registered above, and only ever reads through
  // `publicRepos` (published-only, same as the REST public routes).
  //
  // `buildGraphQLSchema` can throw synchronously (e.g. a GraphQL type-name
  // collision between a content type and a taxonomy type) — since that throw
  // happens inside a `.then()` callback, it rejects `ready`. A `.catch` is
  // attached below so that rejection is HANDLED: an unhandled rejection here
  // would otherwise crash the entire Node process at startup, taking down all
  // REST routes with it, regardless of whether any client ever hits /graphql.
  // Init failure is instead contained to a 500 on /graphql itself.
  if (options.graphql?.enabled) {
    const gqlOptions = options.graphql
    let gqlHandler: Handler | null = null
    let initError: unknown = null
    const ready = import('./graphql/handler.js')
      .then(({ createGraphQLHandler }) => {
        gqlHandler = createGraphQLHandler(registry, graphqlRepos, fieldKeyMaps, programmaticResolver, db, gqlOptions)
      })
      .catch((err: unknown) => {
        initError = err
        const message = err instanceof Error ? err.message : String(err)
        process.stderr.write(`✗ GraphQL schema failed to initialize; /graphql will return 500. ${message}\n`)
      })
    const invokeGraphQL: Handler = async (c) => {
      if (!gqlHandler && !initError) await ready
      if (!gqlHandler) {
        return c.json(
          { ok: false, error: { code: 'GRAPHQL_INIT_FAILED', message: 'GraphQL schema failed to initialize' } },
          500
        )
      }
      return gqlHandler(c, async () => {})
    }
    if (listRateLimit) {
      app.all('/graphql', listRateLimit, invokeGraphQL)
    } else {
      app.all('/graphql', invokeGraphQL)
    }
  }

  // ── Admin routes — all registered AFTER the blanket use() so auth middleware
  //    runs before every handler. registerConfigRoute is called first so its
  //    GET /admin/api/config handler wins over the stale stub in content.ts.
  registerConfigRoute(
    app,
    {
      name: cmsName,
      ...(maxFileSize !== undefined && { maxFileSize }),
      // Cloud storage (s3/cloudinary) issues real presigned URLs, so the admin
      // uploads straight to it — never routing the file through the server
      // (which breaks on serverless). Local storage has no presigned receiver,
      // so it uses the direct upload endpoint.
      presignedUploads: storage.type !== 'local',
    },
    rolesRegistry,
    db,
  )
  registerSchemaRoute(app, registry, db)
  registerUserRoutes(app, db, requirePermission, requireHierarchy)

  registerAdminContentRoutes(app, registry, repos, projectors, mediaRepo, requirePermission, db)
  registerAdminMediaRoutes(app, mediaRepo, storage, requirePermission, maxFileSize)

  return { prefix, app }
}
