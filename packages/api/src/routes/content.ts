import type { Hono, Handler, MiddlewareHandler } from 'hono'
import type {
  SchemaRegistry,
  ContentRepository,
} from '@bobbykim/manguito-cms-core'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { Projectors } from '../projector.js'
import { projectRow } from '../projector.js'
import type { PublicPaths } from '../paths.js'
import {
  SORTABLE_FIELDS,
  RELATION_FIELD_TYPES,
  parsePagination,
  parseInclude,
  parseFilters,
} from './query-params.js'

export type ContentRepos = Record<string, ContentRepository<unknown>>

// ─── Response projection order ────────────────────────────────────────────────
//
// Every read response maps storage keys → labels exactly ONCE, and that mapping
// runs BEFORE the programmatic resolver. Two reasons it sits there rather than
// after:
//   - a programmatic resolver reads its record through `ctx.get(fieldName)`,
//     documented (docs/programmatic-fields.md) as the schema field name — the
//     LABEL — so the row handed to it must already speak labels;
//   - programmatic fields are not column-backed, so their output keys are labels
//     already; mapping afterwards would be a no-op on them.
// Relations are resolved inside the repository, upstream of both, so the mapping
// still lands strictly after relation resolution.

function isPublished(item: unknown): boolean {
  return (item as Record<string, unknown>)['published'] === true
}

export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  projectors: Projectors,
  paths: PublicPaths,
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver
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

  registerListRoute(paths.collection('content'), (c) => {
    const data = Object.values(registry.content_types).map((ct) => ({
      name: ct.name,
      label: ct.label,
      only_one: ct.only_one,
    }))
    return c.json({ ok: true, data })
  })

  registerListRoute(paths.collection('taxonomy'), (c) => {
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

    const relationFieldNames = new Set<string>(
      contentType.fields
        .filter((f) => RELATION_FIELD_TYPES.has(f.field_type))
        .map((f) => f.name)
    )

    // Programmatic fields have no db column — filtering one would be a SQL
    // error, so they're excluded from the filterable set.
    const filterableFieldNames = new Set<string>([
      ...contentType.fields.filter((f) => f.field_type !== 'programmatic').map((f) => f.name),
      ...contentType.system_fields.map((f) => f.name),
    ])

    if (contentType.only_one) {
      app.get(paths.collection(basePath), async (c) => {
        const result = await repo.findMany({ published_only: true, page: 1, per_page: 1 })
        if (result.data.length === 0) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } },
            404
          )
        }
        // Outbound boundary (see "Response projection order" above).
        let data = projectRow(result.data[0] as Record<string, unknown>, typeName, projectors)
        if (resolver?.hasSchema(typeName)) data = await resolver.resolveItem(typeName, data)
        return c.json({ ok: true, data })
      })
    } else {
      registerListRoute(paths.collection(basePath), async (c) => {
        // Inbound boundary: query params speak labels; filters query storage keys.
        const projector = projectors[typeName]!
        const fieldKeys = projector.map
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

        const filtersResult = parseFilters(c.req.url, filterableFieldNames, fieldKeys.columnFor)
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

        // Outbound boundary (see "Response projection order" above).
        const labeled = (result.data as Record<string, unknown>[]).map((row) =>
          projectRow(row, typeName, projectors)
        )
        const data = resolver?.hasSchema(typeName)
          ? await resolver.resolveList(typeName, labeled)
          : labeled
        return c.json({ ...result, data })
      })

      app.get(paths.item(basePath), async (c) => {
        // paths.item() always appends a literal ':slug' segment, but its return
        // type is the widened `string` from PublicPaths — not a template literal
        // type — so Hono can no longer statically prove the param is present.
        const slug = c.req.param('slug')!

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

        // Outbound boundary (see "Response projection order" above).
        let data = projectRow(item as Record<string, unknown>, typeName, projectors)
        if (resolver?.hasSchema(typeName)) data = await resolver.resolveItem(typeName, data)
        return c.json({ ok: true, data })
      })
    }
  }

  for (const [typeName] of Object.entries(registry.taxonomy_types)) {
    const repo = repos[typeName]
    if (!repo) continue

    registerListRoute(paths.taxonomyCollection(typeName), async (c) => {
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

      // Outbound boundary (see "Response projection order" above).
      const labeled = (result.data as Record<string, unknown>[]).map((row) =>
        projectRow(row, typeName, projectors)
      )
      const data = resolver?.hasSchema(typeName)
        ? await resolver.resolveList(typeName, labeled)
        : labeled
      return c.json({ ...result, data })
    })

    app.get(paths.taxonomyItem(typeName), async (c) => {
      // See the ':slug' comment above — same widened-string-return caveat applies.
      const id = c.req.param('id')!
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

      // Outbound boundary (see "Response projection order" above).
      let data = projectRow(item as Record<string, unknown>, typeName, projectors)
      if (resolver?.hasSchema(typeName)) data = await resolver.resolveItem(typeName, data)
      return c.json({ ok: true, data })
    })
  }
}
