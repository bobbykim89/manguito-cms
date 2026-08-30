import { sql } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import type {
  SchemaRegistry,
  MediaRepository,
  FilterValue,
  ParsedField,
  ParsedParagraphType,
} from '@bobbykim/manguito-cms-core'
import {
  SORTABLE_FIELDS,
  RELATION_FIELD_TYPES,
  parsePagination,
  parseInclude,
  parseFilters,
} from '../query-params.js'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  topLevelMediaDelta,
  mergeMediaDeltas,
  applyMediaReferenceDelta,
  type MediaDelta,
} from '../../media-references.js'
import {
  persistParagraphField,
  deleteParagraphField,
  persistJunctionField,
} from '../../relations.js'
import type { createPermissionMiddleware } from '../../middleware/permission.js'
import type { ContentRepos } from '../content.js'
import { isColumnBacked } from '../../field-keys.js'
import { projectRow, type Projectors } from '../../projector.js'

// ─── SQL helpers ─────────────────────────────────────────────────────────────

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return `"${name}"`
}

// Loads the paragraph rows for one field of one parent, descending into the one
// level of nested paragraph fields ADR core/0005 permits. Scoped by parent_id AND
// parent_field so two paragraph fields sharing a paragraph type never mix — the
// reason this read is not delegated to resolveRelationField.
async function loadParagraphRows(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
  pType: ParsedParagraphType,
  parentId: string,
  fieldName: string
): Promise<Record<string, unknown>[]> {
  const result = await db.execute(
    sql`SELECT * FROM ${sql.raw(quoteIdent(pType.db.table_name))} WHERE parent_id = ${parentId} AND parent_field = ${fieldName} ORDER BY "order" ASC`
  )
  const rows = result.rows as Record<string, unknown>[]

  for (const nf of pType.fields) {
    if (nf.db_column !== null) continue
    const comp = nf.ui_component as { component: string; ref?: string }
    if (comp.component !== 'paragraph-embed' || !comp.ref) continue
    const nType = registry.paragraph_types[comp.ref]
    if (!nType) continue
    for (const row of rows) {
      row[nf.name] = await loadParagraphRows(db, registry, nType, row['id'] as string, nf.name)
    }
  }

  return rows
}

async function lookupBasePathId(db: DrizzlePostgresInstance, pathOrName: string): Promise<string | null> {
  const r = await db.execute(
    sql`SELECT id FROM base_paths WHERE path = ${pathOrName} OR name = ${pathOrName} LIMIT 1`
  )
  return (r.rows[0] as { id: string } | undefined)?.id ?? null
}

// ─── Shared query-param helpers ───────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
// Admin repos are created without relation resolution (see app.ts) so edit forms get
// plain foreign-key id strings back — media fields here are raw ids, not resolved
// { id, url, ... } objects.
// ─── List query helpers (shared between content and taxonomy list routes) ─────

type ListQueryResult =
  | {
      ok: true
      pagination: { page: number; per_page: number }
      sortBy: string
      sortOrder: string
      filters: Record<string, FilterValue>
      include: string[]
      search: string
    }
  | { ok: false; response: { code: string; message: string }; status: 400 }

// `columnFor` maps a validated label to its storage column. Filters are
// validated against labels (what the client sends) and emitted as columns (what
// the repository queries) — without it a renamed field would be filtered on a
// column that does not exist.
function parseListQuery(
  url: string,
  schemaFieldNames: Set<string>,
  relationFieldNames: Set<string>,
  columnFor: (label: string) => string | undefined
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

  const filtersResult = parseFilters(url, schemaFieldNames, columnFor)
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

  const search = (searchParams.get('search') ?? '').trim()

  return {
    ok: true,
    pagination,
    sortBy,
    sortOrder,
    filters: filtersResult.filters,
    include,
    search,
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerAdminContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  projectors: Projectors,
  mediaRepo: MediaRepository,
  requirePermission: ReturnType<typeof createPermissionMiddleware>,
  db?: DrizzlePostgresInstance,
): void {
  // ── Content type routes ───────────────────────────────────────────────────

  for (const [typeName, contentType] of Object.entries(registry.content_types)) {
    const basePath = `content/${typeName}`
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

    const projector = projectors[typeName]!
    const fieldKeys = projector.map

    const requiredFields = contentType.fields.filter((f) => f.required)

    const mediaFields = contentType.fields.filter(
      (f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file'
    )

    const paragraphFieldDefs = contentType.fields.filter((f) => f.db_column === null)

    // Free-text search target — text/plain fields (mirrors the "first text field is
    // the title" convention the admin frontend already uses) plus slug, when present.
    // Singleton (only_one) content types have no slug column at all.
    const searchableColumns = [
      ...contentType.fields
        .filter((f) => f.field_type === 'text/plain' && f.db_column !== null)
        .map((f) => f.db_column!.column_name),
      ...(contentType.system_fields.some((f) => f.name === 'slug') ? ['slug'] : []),
    ]

    // GET /admin/api/{base_path}
    app.get(
      `/admin/api/${basePath}`,
      requirePermission('content:read'),
      async (c) => {
        const parsed = parseListQuery(c.req.url, schemaFieldNames, relationFieldNames, fieldKeys.columnFor)
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
        if (parsed.search !== '' && searchableColumns.length > 0) {
          findOpts.search = { term: parsed.search, columns: searchableColumns }
        }

        const result = await repo.findMany(findOpts)

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = result.data.map((row) =>
          projectRow(row as Record<string, unknown>, typeName, projectors)
        )

        return c.json({ ...result, data })
      }
    )

    // GET /admin/api/{base_path}/:id
    app.get(
      `/admin/api/${basePath}/:id`,
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

        // Resolve paragraph and junction fields so the edit form loads real data.
        // This deliberately does NOT reuse the relation module's resolvers: the
        // edit read scopes paragraph rows by parent_id AND parent_field, whereas
        // resolveRelationField scopes by parent_id only. Two paragraph fields of
        // the same paragraph type would be mixed by the resolver — so the more
        // precise per-field read stays here on purpose.
        if (db) {
          const row = item as Record<string, unknown>
          for (const f of contentType.fields) {
            if (f.db_column === null) {
              const comp = f.ui_component as { component: string; ref?: string }
              if (comp.component !== 'paragraph-embed' || !comp.ref) continue
              const pType = registry.paragraph_types[comp.ref]
              if (!pType) continue
              row[f.name] = await loadParagraphRows(db, registry, pType, id, f.name)
            } else if (f.db_column.junction) {
              const j = f.db_column.junction
              const r = await db.execute(
                sql`SELECT ${sql.raw(quoteIdent(j.right_column))} FROM ${sql.raw(quoteIdent(j.table_name))} WHERE ${sql.raw(quoteIdent(j.left_column))} = ${id}`
              )
              row[f.name] = r.rows.map(
                (row) => (row as Record<string, unknown>)[j.right_column] as string
              )
            }
          }
        }

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        // Mapped after the paragraph/junction population above so those
        // label-keyed additions survive.
        const data = projectRow(item as Record<string, unknown>, typeName, projectors)

        return c.json({ ok: true, data })
      }
    )

    // POST /admin/api/{base_path}
    app.post(
      `/admin/api/${basePath}`,
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

        return writeNewItem(c, body)
      }
    )

    // Shared write paths. POST, PATCH and the singleton PUT all funnel through
    // these two functions so the verbs cannot drift apart — the verb-specific
    // pre-checks (slug rules, singleton existence, 404s) stay in the routes.

    const writeNewItem = async (c: Context, body: Record<string, unknown>) => {
        // Inbound boundary: the request body arrives label-keyed; everything
        // downstream (insert data, media delta) works in storage keys.
        const storageBody = fieldKeys.toStorage(body)

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

        if (body['published'] === true) {
          const publishDeny = await requirePermission('content:edit')(c, async () => {})
          if (publishDeny) return publishDeny
        }

        // Classify fields
        const paragraphFields = contentType.fields.filter((f) => f.db_column === null)
        const junctionFields = contentType.fields.filter(
          (f) => f.db_column !== null && f.db_column.junction !== undefined
        )

        // Storage-keyed payload. `storageBody` was normalized at the inbound
        // boundary, so each value is found under its column name.
        const columnBackedFields = contentType.fields.filter(isColumnBacked)
        const columnData: Record<string, unknown> = {
          published: body['published'] ?? false,
        }
        if (contentType.only_one) {
          columnData['slug'] = typeName
        } else {
          columnData['slug'] = body['slug']
        }
        for (const f of columnBackedFields) {
          const key = f.db_column.column_name
          if (!(key in storageBody)) continue
          columnData[key] = storageBody[key]
        }

        // Resolve base_path_id (seeded from routes.json at startup)
        if (db) {
          const basePathId = await lookupBasePathId(db, contentType.default_base_path)
          if (!basePathId) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'BASE_PATH_NOT_FOUND',
                  message: `Base path '${contentType.default_base_path}' not found — run manguito migrate`,
                },
              },
              500
            )
          }
          columnData['base_path_id'] = basePathId
        }

        const item = await repo.create(columnData as Parameters<typeof repo.create>[0])
        const itemId = (item as Record<string, unknown>)['id'] as string

        // Reconcile media reference counts across top-level fields and paragraphs.
        const mediaDeltas: MediaDelta[] = [topLevelMediaDelta(mediaFields, null, storageBody)]

        // Save paragraph and junction rows
        if (db) {
          for (const f of paragraphFields) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            const items = Array.isArray(body[f.name]) ? (body[f.name] as unknown[]) : []
            mediaDeltas.push(await persistParagraphField(db, itemId, contentType.db.table_name, f.name, pType, items, registry))
          }
          for (const f of junctionFields) {
            const junction = f.db_column!.junction!
            const relatedIds = Array.isArray(body[f.name])
              ? (body[f.name] as unknown[]).filter((v): v is string => typeof v === 'string')
              : []
            await persistJunctionField(db, itemId, junction, relatedIds)
          }
        }

        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = projectRow(item as Record<string, unknown>, typeName, projectors)

        return c.json({ ok: true, data }, 201)
    }

    // PATCH /admin/api/{base_path}/:id
    app.patch(
      `/admin/api/${basePath}/:id`,
      requirePermission('content:edit'),
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

        return writeExistingItem(c, id, existing as Record<string, unknown>, body)
      }
    )

    const writeExistingItem = async (
      c: Context,
      id: string,
      existing: Record<string, unknown>,
      body: Record<string, unknown>,
    ) => {
        // Inbound boundary: the request body arrives label-keyed; everything
        // downstream (insert data, media delta) works in storage keys.
        const storageBody = fieldKeys.toStorage(body)

        if (body['published'] === true) {
          const publishDeny = await requirePermission('content:edit')(c, async () => {})
          if (publishDeny) return publishDeny

          // `existing` is a raw SELECT * row (storage-keyed) but
          // checkRequiredFields reads labels, as does `body` — project the row
          // to labels first so a renamed field's stored value is actually seen.
          const merged = { ...fieldKeys.toLabels(existing as Record<string, unknown>), ...body }
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

        // Classify fields
        const patchParagraphFields = contentType.fields.filter((f) => f.db_column === null)
        const patchJunctionFields = contentType.fields.filter(
          (f) => f.db_column !== null && f.db_column.junction !== undefined
        )

        // Storage-keyed payload. `storageBody` was normalized at the inbound
        // boundary, so each value is found under its column name.
        const patchColumnBackedFields = contentType.fields.filter(isColumnBacked)
        const patchData: Record<string, unknown> = {}
        if (!contentType.only_one && 'slug' in body) patchData['slug'] = body['slug']
        if ('published' in body) patchData['published'] = body['published']
        for (const f of patchColumnBackedFields) {
          const key = f.db_column.column_name
          if (!(key in storageBody)) continue
          patchData[key] = storageBody[key]
        }

        const updated = await repo.update(id, patchData as Parameters<typeof repo.update>[1])
        if (!updated) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }

        // Reconcile media reference counts across top-level fields and paragraphs.
        const mediaDeltas: MediaDelta[] = [
          topLevelMediaDelta(mediaFields, existing as Record<string, unknown>, storageBody),
        ]

        // Delete+reinsert paragraph and junction rows
        if (db) {
          for (const f of patchParagraphFields) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            const items = Array.isArray(body[f.name]) ? (body[f.name] as unknown[]) : []
            mediaDeltas.push(await persistParagraphField(db, id, contentType.db.table_name, f.name, pType, items, registry))
          }
          for (const f of patchJunctionFields) {
            const junction = f.db_column!.junction!
            const relatedIds = Array.isArray(body[f.name])
              ? (body[f.name] as unknown[]).filter((v): v is string => typeof v === 'string')
              : []
            await persistJunctionField(db, id, junction, relatedIds)
          }
        }

        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = projectRow(updated as Record<string, unknown>, typeName, projectors)

        return c.json({ ok: true, data })
    }

    // PUT /admin/api/{base_path} — singleton upsert.
    //
    // A singleton has no id in its admin route, so it cannot be addressed by the
    // `/:id` PATCH. The parser declares `http_methods: ['GET','PUT','PATCH']` for
    // `only_one` types and the admin form posts here, so this is the verb that
    // completes that contract: create the row on first save, update it after.
    // Registered only for singletons — collections keep POST/PATCH.
    if (contentType.only_one) {
      app.put(
        `/admin/api/${basePath}`,
        requirePermission('content:edit'),
        async (c) => {
          const body = (await c.req.json()) as Record<string, unknown>

          const existingResult = await repo.findMany({ page: 1, per_page: 1 })
          const existing = existingResult.data[0] as Record<string, unknown> | undefined

          if (!existing) {
            // First save materialises the row, which is a create — gate it on
            // content:create in addition to the route's content:edit.
            const createDeny = await requirePermission('content:create')(c, async () => {})
            if (createDeny) return createDeny
            return writeNewItem(c, body)
          }

          return writeExistingItem(c, existing['id'] as string, existing, body)
        }
      )
    }

    // DELETE /admin/api/{base_path}/:id
    app.delete(
      `/admin/api/${basePath}/:id`,
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

        // A delete removes every media reference the item held (top-level + paragraphs).
        const mediaDeltas: MediaDelta[] = [
          topLevelMediaDelta(mediaFields, item as Record<string, unknown>, null),
        ]

        // Paragraph rows have no FK/cascade back to their parent — clean them up
        // explicitly so they don't leak, and collect their media for decrementing.
        if (db) {
          for (const f of paragraphFieldDefs) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            mediaDeltas.push(await deleteParagraphField(db, id, f.name, pType, registry))
          }
        }

        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

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

    const projector = projectors[typeName]!
    const fieldKeys = projector.map

    const requiredFields = taxonomyType.fields.filter((f) => f.required)

    const mediaFields = taxonomyType.fields.filter(
      (f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file'
    )

    const paragraphFieldDefs = taxonomyType.fields.filter((f) => f.db_column === null)

    const searchableColumns = [
      ...taxonomyType.fields
        .filter((f) => f.field_type === 'text/plain' && f.db_column !== null)
        .map((f) => f.db_column!.column_name),
      ...(taxonomyType.system_fields.some((f) => f.name === 'slug') ? ['slug'] : []),
    ]

    // GET /admin/api/taxonomy/{type}
    app.get(
      `/admin/api/taxonomy/${typeName}`,
      requirePermission('content:read'),
      async (c) => {
        const parsed = parseListQuery(c.req.url, schemaFieldNames, relationFieldNames, fieldKeys.columnFor)
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
        if (parsed.search !== '' && searchableColumns.length > 0) {
          findOpts.search = { term: parsed.search, columns: searchableColumns }
        }

        const result = await repo.findMany(findOpts)

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = result.data.map((row) =>
          projectRow(row as Record<string, unknown>, typeName, projectors)
        )

        return c.json({ ...result, data })
      }
    )

    // GET /admin/api/taxonomy/{type}/:id
    app.get(
      `/admin/api/taxonomy/${typeName}/:id`,
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

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = projectRow(item as Record<string, unknown>, typeName, projectors)

        return c.json({ ok: true, data })
      }
    )

    // POST /admin/api/taxonomy/{type}
    app.post(
      `/admin/api/taxonomy/${typeName}`,
      requirePermission('content:create'),
      async (c) => {
        const body = (await c.req.json()) as Record<string, unknown>

        // Inbound boundary: the request body arrives label-keyed; everything
        // downstream (insert data, media delta) works in storage keys.
        const storageBody = fieldKeys.toStorage(body)

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

        if (body['published'] === true) {
          const publishDeny = await requirePermission('content:edit')(c, async () => {})
          if (publishDeny) return publishDeny
        }

        // Filter to column-only fields
        const taxParagraphFields = taxonomyType.fields.filter((f) => f.db_column === null)

        // Storage-keyed payload. `storageBody` was normalized at the inbound
        // boundary, so each value is found under its column name.
        const taxColumnBackedFields = taxonomyType.fields.filter(isColumnBacked)
        const taxColumnData: Record<string, unknown> = {
          published: body['published'] ?? false,
        }
        for (const f of taxColumnBackedFields) {
          const key = f.db_column.column_name
          if (!(key in storageBody)) continue
          taxColumnData[key] = storageBody[key]
        }

        const item = await repo.create(taxColumnData as Parameters<typeof repo.create>[0])
        const taxItemId = (item as Record<string, unknown>)['id'] as string

        // Reconcile media reference counts across top-level fields and paragraphs.
        const mediaDeltas: MediaDelta[] = [topLevelMediaDelta(mediaFields, null, storageBody)]

        if (db) {
          for (const f of taxParagraphFields) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            const items = Array.isArray(body[f.name]) ? (body[f.name] as unknown[]) : []
            mediaDeltas.push(await persistParagraphField(db, taxItemId, taxonomyType.db.table_name, f.name, pType, items, registry))
          }
        }

        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = projectRow(item as Record<string, unknown>, typeName, projectors)

        return c.json({ ok: true, data }, 201)
      }
    )

    // PATCH /admin/api/taxonomy/{type}/:id
    app.patch(
      `/admin/api/taxonomy/${typeName}/:id`,
      requirePermission('content:edit'),
      async (c) => {
        const id = c.req.param('id')
        const body = (await c.req.json()) as Record<string, unknown>

        // Inbound boundary: the request body arrives label-keyed; everything
        // downstream (insert data, media delta) works in storage keys.
        const storageBody = fieldKeys.toStorage(body)

        const existing = await repo.findOne(id)
        if (!existing) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' } },
            404
          )
        }

        if (body['published'] === true) {
          const publishDeny = await requirePermission('content:edit')(c, async () => {})
          if (publishDeny) return publishDeny

          // `existing` is a raw SELECT * row (storage-keyed) but
          // checkRequiredFields reads labels, as does `body` — project the row
          // to labels first so a renamed field's stored value is actually seen.
          const merged = { ...fieldKeys.toLabels(existing as Record<string, unknown>), ...body }
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

        // Filter to column-only fields
        const taxPatchParagraphFields = taxonomyType.fields.filter((f) => f.db_column === null)

        // Storage-keyed payload. `storageBody` was normalized at the inbound
        // boundary, so each value is found under its column name.
        const taxPatchColumnBackedFields = taxonomyType.fields.filter(isColumnBacked)
        const taxPatchData: Record<string, unknown> = {}
        if ('published' in body) taxPatchData['published'] = body['published']
        for (const f of taxPatchColumnBackedFields) {
          const key = f.db_column.column_name
          if (!(key in storageBody)) continue
          taxPatchData[key] = storageBody[key]
        }

        const updated = await repo.update(id, taxPatchData as Parameters<typeof repo.update>[1])
        if (!updated) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Taxonomy term not found' } },
            404
          )
        }

        // Reconcile media reference counts across top-level fields and paragraphs.
        const mediaDeltas: MediaDelta[] = [
          topLevelMediaDelta(mediaFields, existing as Record<string, unknown>, storageBody),
        ]

        if (db) {
          for (const f of taxPatchParagraphFields) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            const items = Array.isArray(body[f.name]) ? (body[f.name] as unknown[]) : []
            mediaDeltas.push(await persistParagraphField(db, id, taxonomyType.db.table_name, f.name, pType, items, registry))
          }
        }

        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = projectRow(updated as Record<string, unknown>, typeName, projectors)

        return c.json({ ok: true, data })
      }
    )

    // DELETE /admin/api/taxonomy/{type}/:id
    app.delete(
      `/admin/api/taxonomy/${typeName}/:id`,
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

        // A delete removes every media reference the item held (top-level + paragraphs).
        const mediaDeltas: MediaDelta[] = [
          topLevelMediaDelta(mediaFields, item as Record<string, unknown>, null),
        ]

        if (db) {
          for (const f of paragraphFieldDefs) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            mediaDeltas.push(await deleteParagraphField(db, id, f.name, pType, registry))
          }
        }

        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

        await repo.delete(id)
        return c.json({ ok: true })
      }
    )
  }

  // ── Config endpoint ───────────────────────────────────────────────────────

  app.get('/admin/api/config', (c) => {
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
