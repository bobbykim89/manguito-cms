import type { Hono } from 'hono'
import type {
  SchemaRegistry,
  MediaRepository,
  FilterValue,
  FilterOperator,
  ParsedField,
} from '@bobbykim/manguito-cms-core'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import type { ContentRepos } from '../content.js'

// ─── Shared query-param helpers ───────────────────────────────────────────────

const SORTABLE_FIELDS = new Set<string>(['title', 'created_at', 'updated_at'])

const RELATION_FIELD_TYPES = new Set([
  'paragraph',
  'reference',
  'image',
  'video',
  'file',
])

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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

// ─── Validation helpers ───────────────────────────────────────────────────────

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

function checkRequiredFields(
  fields: ParsedField[],
  data: Record<string, unknown>
): { field: string; message: string }[] {
  return fields
    .filter((f) => f.required && isEmpty(data[f.name]))
    .map((f) => ({ field: f.name, message: `${f.label} is required` }))
}

// Extract IDs from already-resolved media field values ({ id: string } objects).
function collectMediaIds(
  mediaFields: ParsedField[],
  item: Record<string, unknown>
): string[] {
  const ids: string[] = []
  for (const field of mediaFields) {
    const value = item[field.name]
    if (value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>)['id'] === 'string') {
      ids.push((value as Record<string, unknown>)['id'] as string)
    }
  }
  return ids
}

// ─── List query helpers (shared between content and taxonomy list routes) ─────

type ListQueryResult =
  | {
      ok: true
      pagination: { page: number; per_page: number }
      sortBy: string
      sortOrder: string
      filters: Record<string, FilterValue>
      include: string[]
    }
  | { ok: false; response: { code: string; message: string }; status: 400 }

function parseListQuery(
  url: string,
  schemaFieldNames: Set<string>,
  relationFieldNames: Set<string>
): ListQueryResult {
  const searchParams = new URL(url).searchParams

  const pagination = parsePagination(
    searchParams.get('page') ?? undefined,
    searchParams.get('per_page') ?? undefined
  )
  if (!pagination.ok) {
    return {
      ok: false,
      response: {
        code: 'INVALID_PAGINATION',
        message: 'page must be ≥ 1 and per_page must be between 1 and 100',
      },
      status: 400,
    }
  }

  const sortBy = searchParams.get('sort_by') ?? 'created_at'
  if (!SORTABLE_FIELDS.has(sortBy)) {
    return {
      ok: false,
      response: {
        code: 'INVALID_SORT_FIELD',
        message: `'${sortBy}' is not sortable. Allowed: title, created_at, updated_at`,
      },
      status: 400,
    }
  }

  const sortOrder = searchParams.get('sort_order') ?? 'asc'
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    return {
      ok: false,
      response: { code: 'INVALID_SORT_FIELD', message: `sort_order must be 'asc' or 'desc'` },
      status: 400,
    }
  }

  const filtersResult = parseFilters(url, schemaFieldNames)
  if (!filtersResult.ok) {
    return {
      ok: false,
      response: {
        code: 'INVALID_FILTER_FIELD',
        message: `Filter field '${filtersResult.invalidField}' does not exist on this schema`,
      },
      status: 400,
    }
  }

  const include = parseInclude(searchParams.get('include') ?? undefined)
  for (const field of include) {
    if (!relationFieldNames.has(field)) {
      return {
        ok: false,
        response: { code: 'INVALID_INCLUDE_FIELD', message: `'${field}' is not a valid relation field` },
        status: 400,
      }
    }
  }

  return {
    ok: true,
    pagination,
    sortBy,
    sortOrder,
    filters: filtersResult.filters,
    include,
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerAdminContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  mediaRepo: MediaRepository
): void {
  // ── Content type routes ───────────────────────────────────────────────────

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

    const requiredFields = contentType.fields.filter((f) => f.required)

    const mediaFields = contentType.fields.filter(
      (f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file'
    )

    // GET /admin/api/{base_path}
    app.get(
      `/admin/api/${basePath}`,
      requireAuth,
      requirePermission('content:read'),
      async (c) => {
        const parsed = parseListQuery(c.req.url, schemaFieldNames, relationFieldNames)
        if (!parsed.ok) {
          return c.json({ ok: false, error: parsed.response }, parsed.status)
        }

        const publishedParam = c.req.query('published')
        const extraFilters: Record<string, FilterValue> = {}
        if (publishedParam === 'false') extraFilters['published'] = false

        const findOpts: Parameters<typeof repo.findMany>[0] = {
          page: parsed.pagination.page,
          per_page: parsed.pagination.per_page,
          sort_by: parsed.sortBy as 'title' | 'created_at' | 'updated_at',
          sort_order: parsed.sortOrder as 'asc' | 'desc',
          filters: { ...parsed.filters, ...extraFilters },
          include: parsed.include,
        }
        if (publishedParam === 'true') findOpts.published_only = true

        const result = await repo.findMany(findOpts)

        return c.json(result)
      }
    )

    // GET /admin/api/{base_path}/:id
    app.get(
      `/admin/api/${basePath}/:id`,
      requireAuth,
      requirePermission('content:read'),
      async (c) => {
        const id = c.req.param('id')
        const item = await repo.findOne(id)

        if (!item) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }

        return c.json({ ok: true, data: item })
      }
    )

    // POST /admin/api/{base_path}
    app.post(
      `/admin/api/${basePath}`,
      requireAuth,
      requirePermission('content:create'),
      async (c) => {
        const body = (await c.req.json()) as Record<string, unknown>

        if (contentType.only_one) {
          const existing = await repo.findMany({ page: 1, per_page: 1 })
          if (existing.meta.total > 0) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'SINGLETON_ALREADY_EXISTS',
                  message: `Only one instance of '${contentType.label}' is allowed`,
                },
              },
              409
            )
          }
        } else {
          const slug = body['slug']
          if (typeof slug !== 'string' || slug.trim() === '') {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Required fields are missing',
                  details: [{ field: 'slug', message: 'Slug is required' }],
                },
              },
              422
            )
          }

          if (!SLUG_PATTERN.test(slug)) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'INVALID_SLUG_FORMAT',
                  message:
                    'Slug must be lowercase alphanumeric with hyphens only — no leading or trailing hyphens',
                },
              },
              422
            )
          }

          const conflict = await repo.findBySlug(slug)
          if (conflict) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'SLUG_CONFLICT',
                  message: `Slug '${slug}' already exists for this content type`,
                },
              },
              409
            )
          }
        }

        const fieldErrors = checkRequiredFields(requiredFields, body)
        if (fieldErrors.length > 0) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Required fields are missing',
                details: fieldErrors,
              },
            },
            422
          )
        }

        const item = await repo.create(body as Parameters<typeof repo.create>[0])
        return c.json({ ok: true, data: item }, 201)
      }
    )

    // PATCH /admin/api/{base_path}/:id
    app.patch(
      `/admin/api/${basePath}/:id`,
      requireAuth,
      requirePermission('content:update'),
      async (c) => {
        const id = c.req.param('id')
        const body = (await c.req.json()) as Record<string, unknown>

        const existing = await repo.findOne(id)
        if (!existing) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }

        if (!contentType.only_one && 'slug' in body) {
          const slug = body['slug']
          if (typeof slug !== 'string' || slug.trim() === '') {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Required fields are missing',
                  details: [{ field: 'slug', message: 'Slug cannot be empty' }],
                },
              },
              422
            )
          }

          if (!SLUG_PATTERN.test(slug)) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'INVALID_SLUG_FORMAT',
                  message:
                    'Slug must be lowercase alphanumeric with hyphens only — no leading or trailing hyphens',
                },
              },
              422
            )
          }

          const conflict = await repo.findBySlug(slug)
          if (conflict && (conflict as Record<string, unknown>)['id'] !== id) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'SLUG_CONFLICT',
                  message: `Slug '${slug}' already exists for this content type`,
                },
              },
              409
            )
          }
        }

        if (body['published'] === true) {
          // content:publish is a distinct permission from content:update — enforced in Phase 6.
          const publishDeny = await requirePermission('content:publish')(c, async () => {})
          if (publishDeny) return publishDeny

          const merged = { ...(existing as Record<string, unknown>), ...body }
          const fieldErrors = checkRequiredFields(requiredFields, merged)
          if (fieldErrors.length > 0) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'PUBLISH_VALIDATION_ERROR',
                  message: 'Cannot publish — required fields are missing',
                  details: fieldErrors,
                },
              },
              422
            )
          }
        }

        const updated = await repo.update(id, body as Parameters<typeof repo.update>[1])
        if (!updated) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }

        return c.json({ ok: true, data: updated })
      }
    )

    // DELETE /admin/api/{base_path}/:id
    app.delete(
      `/admin/api/${basePath}/:id`,
      requireAuth,
      requirePermission('content:delete'),
      async (c) => {
        const id = c.req.param('id')
        const item = await repo.findOne(id)

        if (!item) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }

        const mediaIds = collectMediaIds(mediaFields, item as Record<string, unknown>)
        if (mediaIds.length > 0) {
          await mediaRepo.decrementReferenceCount(mediaIds)
        }

        await repo.delete(id)
        return c.json({ ok: true })
      }
    )
  }

  // ── Taxonomy type routes ──────────────────────────────────────────────────

  for (const [typeName, taxonomyType] of Object.entries(registry.taxonomy_types)) {
    const repo = repos[typeName]
    if (!repo) continue

    const schemaFieldNames = new Set<string>([
      ...taxonomyType.fields.map((f) => f.name),
      ...taxonomyType.system_fields.map((f) => f.name),
    ])

    const relationFieldNames = new Set<string>(
      taxonomyType.fields
        .filter((f) => RELATION_FIELD_TYPES.has(f.field_type))
        .map((f) => f.name)
    )

    const requiredFields = taxonomyType.fields.filter((f) => f.required)

    const mediaFields = taxonomyType.fields.filter(
      (f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file'
    )

    // GET /admin/api/taxonomy/{type}
    app.get(
      `/admin/api/taxonomy/${typeName}`,
      requireAuth,
      requirePermission('content:read'),
      async (c) => {
        const parsed = parseListQuery(c.req.url, schemaFieldNames, relationFieldNames)
        if (!parsed.ok) {
          return c.json({ ok: false, error: parsed.response }, parsed.status)
        }

        const publishedParam = c.req.query('published')
        const extraFilters: Record<string, FilterValue> = {}
        if (publishedParam === 'false') extraFilters['published'] = false

        const findOpts: Parameters<typeof repo.findMany>[0] = {
          page: parsed.pagination.page,
          per_page: parsed.pagination.per_page,
          sort_by: parsed.sortBy as 'title' | 'created_at' | 'updated_at',
          sort_order: parsed.sortOrder as 'asc' | 'desc',
          filters: { ...parsed.filters, ...extraFilters },
          include: parsed.include,
        }
        if (publishedParam === 'true') findOpts.published_only = true

        const result = await repo.findMany(findOpts)

        return c.json(result)
      }
    )

    // GET /admin/api/taxonomy/{type}/:id
    app.get(
      `/admin/api/taxonomy/${typeName}/:id`,
      requireAuth,
      requirePermission('content:read'),
      async (c) => {
        const id = c.req.param('id')
        const item = await repo.findOne(id)

        if (!item) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' } },
            404
          )
        }

        return c.json({ ok: true, data: item })
      }
    )

    // POST /admin/api/taxonomy/{type}
    app.post(
      `/admin/api/taxonomy/${typeName}`,
      requireAuth,
      requirePermission('content:create'),
      async (c) => {
        const body = (await c.req.json()) as Record<string, unknown>

        const fieldErrors = checkRequiredFields(requiredFields, body)
        if (fieldErrors.length > 0) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Required fields are missing',
                details: fieldErrors,
              },
            },
            422
          )
        }

        const item = await repo.create(body as Parameters<typeof repo.create>[0])
        return c.json({ ok: true, data: item }, 201)
      }
    )

    // PATCH /admin/api/taxonomy/{type}/:id
    app.patch(
      `/admin/api/taxonomy/${typeName}/:id`,
      requireAuth,
      requirePermission('content:update'),
      async (c) => {
        const id = c.req.param('id')
        const body = (await c.req.json()) as Record<string, unknown>

        const existing = await repo.findOne(id)
        if (!existing) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' } },
            404
          )
        }

        if (body['published'] === true) {
          const publishDeny = await requirePermission('content:publish')(c, async () => {})
          if (publishDeny) return publishDeny

          const merged = { ...(existing as Record<string, unknown>), ...body }
          const fieldErrors = checkRequiredFields(requiredFields, merged)
          if (fieldErrors.length > 0) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'PUBLISH_VALIDATION_ERROR',
                  message: 'Cannot publish — required fields are missing',
                  details: fieldErrors,
                },
              },
              422
            )
          }
        }

        const updated = await repo.update(id, body as Parameters<typeof repo.update>[1])
        if (!updated) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' } },
            404
          )
        }

        return c.json({ ok: true, data: updated })
      }
    )

    // DELETE /admin/api/taxonomy/{type}/:id
    app.delete(
      `/admin/api/taxonomy/${typeName}/:id`,
      requireAuth,
      requirePermission('content:delete'),
      async (c) => {
        const id = c.req.param('id')
        const item = await repo.findOne(id)

        if (!item) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' } },
            404
          )
        }

        const mediaIds = collectMediaIds(mediaFields, item as Record<string, unknown>)
        if (mediaIds.length > 0) {
          await mediaRepo.decrementReferenceCount(mediaIds)
        }

        await repo.delete(id)
        return c.json({ ok: true })
      }
    )
  }

  // ── Config endpoint ───────────────────────────────────────────────────────

  app.get('/admin/api/config', requireAuth, (c) => {
    return c.json({
      ok: true,
      data: {
        content_types: Object.values(registry.content_types).map((ct) => ({
          name: ct.name,
          label: ct.label,
          only_one: ct.only_one,
          default_base_path: ct.default_base_path,
          fields: ct.fields,
          system_fields: ct.system_fields,
        })),
        taxonomy_types: Object.values(registry.taxonomy_types).map((tt) => ({
          name: tt.name,
          label: tt.label,
          fields: tt.fields,
          system_fields: tt.system_fields,
        })),
        enum_types: Object.values(registry.enum_types).map((et) => ({
          name: et.name,
          label: et.label,
          values: et.values,
        })),
      },
    })
  })
}
