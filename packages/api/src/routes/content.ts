import type { Hono } from 'hono'
import type {
  SchemaRegistry,
  ContentRepository,
  FilterValue,
  FilterOperator,
} from '@bobbykim/manguito-cms-core'

export type ContentRepos = Record<string, ContentRepository<unknown>>

const SORTABLE_FIELDS = new Set<string>(['title', 'created_at', 'updated_at'])

const RELATION_FIELD_TYPES = new Set([
  'paragraph',
  'reference',
  'image',
  'video',
  'file',
])

function parsePagination(
  pageStr: string | undefined,
  perPageStr: string | undefined
): { ok: true; page: number; per_page: number } | { ok: false } {
  const page = pageStr !== undefined ? Number(pageStr) : 1
  const per_page = perPageStr !== undefined ? Number(perPageStr) : 10

  if (!Number.isInteger(page) || page < 1) return { ok: false }
  if (!Number.isInteger(per_page) || per_page < 1 || per_page > 100) return { ok: false }
  return { ok: true, page, per_page }
}

function parseInclude(includeParam: string | undefined): string[] {
  if (!includeParam) return []
  return includeParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseFilters(
  url: string,
  validFields: Set<string>
): { ok: true; filters: Record<string, FilterValue> } | { ok: false; invalidField: string } {
  const { searchParams } = new URL(url)
  const filters: Record<string, FilterValue> = {}

  for (const [key, value] of searchParams.entries()) {
    const simpleMatch = /^filter\[([^\]]+)\]$/.exec(key)
    const opMatch = /^filter\[([^\]]+)\]\[([^\]]+)\]$/.exec(key)

    if (simpleMatch) {
      const field = simpleMatch[1]!
      if (!validFields.has(field)) return { ok: false, invalidField: field }
      const existing = filters[field]
      if (existing !== undefined) {
        filters[field] = Array.isArray(existing)
          ? [...existing, value]
          : [existing as string | number | boolean, value]
      } else {
        filters[field] = value
      }
    } else if (opMatch) {
      const field = opMatch[1]!
      const operator = opMatch[2]!
      if (!validFields.has(field)) return { ok: false, invalidField: field }
      if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) continue
      const existing = (filters[field] as FilterOperator | undefined) ?? {}
      filters[field] = { ...(existing as FilterOperator), [operator]: value }
    }
  }

  return { ok: true, filters }
}

function isPublished(item: unknown): boolean {
  return (item as Record<string, unknown>)['published'] === true
}

export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos
): void {
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
      app.get(`/api/${basePath}`, async (c) => {
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

        const item = await repo.findBySlug(slug)

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

    app.get(`/api/taxonomy/${typeName}`, async (c) => {
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
