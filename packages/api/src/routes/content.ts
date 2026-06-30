import type { Hono, Handler, MiddlewareHandler } from 'hono'
import type {
  SchemaRegistry,
  ContentRepository,
  FilterValue,
} from '@bobbykim/manguito-cms-core'
import {
  SORTABLE_FIELDS,
  RELATION_FIELD_TYPES,
  parsePagination,
  parseInclude,
  parseFilters,
} from './query-params.js'

export type ContentRepos = Record<string, ContentRepository<unknown>>

function isPublished(item: unknown): boolean {
  return (item as Record<string, unknown>)['published'] === true
}

export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  listRateLimit?: MiddlewareHandler
): void {
  // ── Meta-endpoints: list available schema types ───────────────────────────
  // Registered before the dynamic per-type routes to avoid path conflicts.

  function registerListRoute(path: string, handler: Handler): void {
    if (listRateLimit) {
      app.get(path, listRateLimit, handler)
    } else {
      app.get(path, handler)
    }
  }

  registerListRoute('/api/content', (c) => {
    const data = Object.values(registry.content_types).map((ct) => ({
      name: ct.name,
      label: ct.label,
      only_one: ct.only_one,
    }))
    return c.json({ ok: true, data })
  })

  registerListRoute('/api/taxonomy', (c) => {
    const data = Object.values(registry.taxonomy_types).map((tt) => ({
      name: tt.name,
      label: tt.label,
    }))
    return c.json({ ok: true, data })
  })

  // ── Per-type content routes ───────────────────────────────────────────────

  for (const [typeName, contentType] of Object.entries(registry.content_types)) {
    const basePath = contentType.default_base_path
    const repo = repos[typeName]
    if (!repo) continue

    const schemaFieldNames = new Set<string>([
      ...contentType.fields.map((f) => f.name),
      ...contentType.system_fields.map((f) => f.name),
    ])

    const relationFieldNames = new Set<string>(
      contentType.fields
        .filter((f) => RELATION_FIELD_TYPES.has(f.field_type))
        .map((f) => f.name)
    )

    if (contentType.only_one) {
      app.get(`/api/${basePath}`, async (c) => {
        const result = await repo.findMany({ published_only: true, page: 1, per_page: 1 })
        if (result.data.length === 0) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }
        return c.json({ ok: true, data: result.data[0] })
      })
    } else {
      registerListRoute(`/api/${basePath}`, async (c) => {
        const pagination = parsePagination(c.req.query('page'), c.req.query('per_page'))
        if (!pagination.ok) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_PAGINATION',
                message: 'page must be ≥ 1 and per_page must be between 1 and 100',
              },
            },
            400
          )
        }

        const sortBy = c.req.query('sort_by') ?? 'created_at'
        if (!SORTABLE_FIELDS.has(sortBy)) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_SORT_FIELD',
                message: `'${sortBy}' is not sortable. Allowed: title, created_at, updated_at`,
              },
            },
            400
          )
        }

        const sortOrder = c.req.query('sort_order') ?? 'asc'
        if (sortOrder !== 'asc' && sortOrder !== 'desc') {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_SORT_FIELD',
                message: `sort_order must be 'asc' or 'desc'`,
              },
            },
            400
          )
        }

        const filtersResult = parseFilters(c.req.url, schemaFieldNames)
        if (!filtersResult.ok) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_FILTER_FIELD',
                message: `Filter field '${filtersResult.invalidField}' does not exist on this content type`,
              },
            },
            400
          )
        }

        const include = parseInclude(c.req.query('include'))
        for (const field of include) {
          if (!relationFieldNames.has(field)) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'INVALID_INCLUDE_FIELD',
                  message: `'${field}' is not a valid relation field`,
                },
              },
              400
            )
          }
        }

        const result = await repo.findMany({
          published_only: true,
          page: pagination.page,
          per_page: pagination.per_page,
          sort_by: sortBy as 'title' | 'created_at' | 'updated_at',
          sort_order: sortOrder as 'asc' | 'desc',
          filters: filtersResult.filters,
          include,
        })

        return c.json(result)
      })

      app.get(`/api/${basePath}/:slug`, async (c) => {
        const slug = c.req.param('slug')

        const include = parseInclude(c.req.query('include'))
        for (const field of include) {
          if (!relationFieldNames.has(field)) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'INVALID_INCLUDE_FIELD',
                  message: `'${field}' is not a valid relation field`,
                },
              },
              400
            )
          }
        }

        const item = await repo.findBySlug(slug, include)

        if (!item || !isPublished(item)) {
          return c.json(
            {
              ok: false,
              error: { code: 'SLUG_NOT_FOUND', message: `No item found with slug '${slug}'` },
            },
            404
          )
        }

        return c.json({ ok: true, data: item })
      })
    }
  }

  for (const [typeName] of Object.entries(registry.taxonomy_types)) {
    const repo = repos[typeName]
    if (!repo) continue

    registerListRoute(`/api/taxonomy/${typeName}`, async (c) => {
      const pagination = parsePagination(c.req.query('page'), c.req.query('per_page'))
      if (!pagination.ok) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'INVALID_PAGINATION',
              message: 'page must be ≥ 1 and per_page must be between 1 and 100',
            },
          },
          400
        )
      }

      const result = await repo.findMany({
        published_only: true,
        page: pagination.page,
        per_page: pagination.per_page,
      })

      return c.json(result)
    })

    app.get(`/api/taxonomy/${typeName}/:id`, async (c) => {
      const id = c.req.param('id')
      const item = await repo.findOne(id)

      if (!item || !isPublished(item)) {
        return c.json(
          {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' },
          },
          404
        )
      }

      return c.json({ ok: true, data: item })
    })
  }
}
