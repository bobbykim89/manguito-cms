import type { Hono, Handler, MiddlewareHandler } from 'hono'
import type {
  SchemaRegistry,
  ContentRepository,
} from '@bobbykim/manguito-cms-core'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { Projectors } from '../projector.js'
import { projectRow } from '../projector.js'
import { isColumnBacked } from '../field-keys.js'
import type { VersionedPaths } from '../paths.js'
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
//     LABEL — and since `ctx.get(fieldName)` takes the field's CURRENT name on
//     every version, the record handed to the resolver is projected with
//     CURRENT's projectors, not the served version's. The response itself is
//     still projected with the served version's own projectors; only the
//     resolver's programmatic keys cross from one record to the other;
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
  paths: VersionedPaths,
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver,
  // Current's projectors, for the record a programmatic resolver reads. Omitted
  // when the routes being registered ARE current's, which is the default.
  resolverProjectors?: Projectors
): void {
  // A programmatic resolver is written once, against the schema as it is now,
  // so on every version it reads a record in CURRENT's labels. The response
  // still speaks the served version's labels. Only the resolver's computed
  // values are merged across, and programmatic fields are never versioned, so
  // their names are the same in both. (A computed field that reuses a live
  // version's field name is an authoring mistake; see the 2f spec's Residuals.)
  const forResolver = resolverProjectors ?? projectors

  function pickProgrammatic(
    resolved: Record<string, unknown>,
    names: readonly string[]
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    // `in`, not `!== undefined`: resolveList sets only on_list fields, and a
    // field it skipped must stay absent rather than become a present undefined.
    for (const name of names) if (name in resolved) out[name] = resolved[name]
    return out
  }

  async function respondItem(
    row: Record<string, unknown>,
    typeName: string,
    programmatic: readonly string[]
  ): Promise<Record<string, unknown>> {
    const data = projectRow(row, typeName, projectors)
    if (!resolver?.hasSchema(typeName)) return data
    const resolved = await resolver.resolveItem(typeName, projectRow(row, typeName, forResolver))
    return { ...data, ...pickProgrammatic(resolved, programmatic) }
  }

  async function respondList(
    rows: Record<string, unknown>[],
    typeName: string,
    programmatic: readonly string[]
  ): Promise<Record<string, unknown>[]> {
    const data = rows.map((row) => projectRow(row, typeName, projectors))
    if (!resolver?.hasSchema(typeName)) return data
    const resolved = await resolver.resolveList(
      typeName,
      rows.map((row) => projectRow(row, typeName, forResolver))
    )
    return data.map((d, i) => ({ ...d, ...pickProgrammatic(resolved[i]!, programmatic) }))
  }

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

    // This version's own field-key map. `projectors` is built per version by
    // the caller (versions.ts/app.ts), so this is what lets the boundary
    // below speak THIS version's labels rather than current's.
    const fieldKeys = projectors[typeName]!.map

    const programmatic = contentType.fields
      .filter((f) => f.field_type === 'programmatic')
      .map((f) => f.name)

    // Relation fields a consumer may `?include=`, keyed by the name THIS
    // version speaks and mapped to the registry name the repository speaks.
    // They differ for a column-backed relation this version renames. The
    // repository's relation map stays keyed by registry name, because it also
    // has to cover paragraph and many-to-many fields, which have no column.
    const includeNames = new Map<string, string>()
    for (const f of contentType.fields) {
      if (!RELATION_FIELD_TYPES.has(f.field_type)) continue
      if (isColumnBacked(f)) {
        const label = fieldKeys.labelFor(f.db_column.column_name)
        if (label !== undefined) includeNames.set(label, f.name)
      } else {
        includeNames.set(f.name, f.name)
      }
    }

    // Validates a `?include=` list in this version's vocabulary and translates
    // it into the repository's. An unknown name is an expected client error, so
    // it is returned rather than thrown.
    function translateInclude(
      requested: string[]
    ): { ok: true; include: string[] } | { ok: false; field: string } {
      const include: string[] = []
      for (const field of requested) {
        const registryName = includeNames.get(field)
        if (registryName === undefined) return { ok: false, field }
        include.push(registryName)
      }
      return { ok: true, include }
    }

    // This version's own filter/sort surface: the labels THIS version
    // exposes (`fieldKeys.labels` — column-backed fields only, so
    // programmatic/paragraph/many-to-many fields are already excluded) plus
    // system fields, which are identical on every version. Sourcing this from
    // `contentType.fields` (always CURRENT) instead would reject a pinned
    // version's own label and accept current's — a name this version's map
    // cannot resolve, which would otherwise reach SQL unresolved.
    const filterableFieldNames = new Set<string>([
      ...fieldKeys.labels,
      ...contentType.system_fields.map((f) => f.name),
    ])
    // SORTABLE_FIELDS is the same across every version; only the subset THIS
    // version can actually resolve (its own labels, plus system fields) is
    // safe to accept from a request. A label absent from this version's map
    // must be rejected here, not discovered as a 500 once it reaches SQL.
    const sortableFieldNames = new Set(
      [...SORTABLE_FIELDS].filter((f) => filterableFieldNames.has(f))
    )

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
        const data = await respondItem(
          result.data[0] as Record<string, unknown>,
          typeName,
          programmatic
        )
        return c.json({ ok: true, data })
      })
    } else {
      registerListRoute(paths.collection(basePath), async (c) => {
        // Inbound boundary: query params speak labels; filters query storage keys.
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
        if (!sortableFieldNames.has(sortBy)) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_SORT_FIELD',
                message: `'${sortBy}' is not sortable. Allowed: ${[...sortableFieldNames].join(', ')}`,
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

        const translated = translateInclude(parseInclude(c.req.query('include')))
        if (!translated.ok) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_INCLUDE_FIELD',
                message: `'${translated.field}' is not a valid relation field`,
              },
            },
            400
          )
        }
        const include = translated.include

        // sortBy is validated above against sortableFieldNames — this
        // version's own labels plus its (version-invariant) system fields —
        // so it is either a label fieldKeys can resolve, or a system field
        // name that already IS its own storage column. The cast on
        // `sort_by` below is a narrow lie — core types it as the label
        // union, but the repository immediately re-validates the mapped
        // value against sortableColumns.
        const sortColumn = fieldKeys.labels.includes(sortBy)
          ? fieldKeys.columnFor(sortBy)!
          : sortBy

        const result = await repo.findMany({
          published_only: true,
          page: pagination.page,
          per_page: pagination.per_page,
          sort_by: sortColumn as 'title' | 'created_at' | 'updated_at',
          sort_order: sortOrder as 'asc' | 'desc',
          filters: filtersResult.filters,
          include,
        })

        // Outbound boundary (see "Response projection order" above).
        const data = await respondList(result.data as Record<string, unknown>[], typeName, programmatic)
        return c.json({ ...result, data })
      })

      app.get(paths.item(basePath), async (c) => {
        // paths.item() always appends a literal ':slug' segment, but its return
        // type is the widened `string` from PublicPaths — not a template literal
        // type — so Hono can no longer statically prove the param is present.
        const slug = c.req.param('slug')!

        const translated = translateInclude(parseInclude(c.req.query('include')))
        if (!translated.ok) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_INCLUDE_FIELD',
                message: `'${translated.field}' is not a valid relation field`,
              },
            },
            400
          )
        }
        const include = translated.include

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
        const data = await respondItem(item as Record<string, unknown>, typeName, programmatic)
        return c.json({ ok: true, data })
      })
    }
  }

  for (const [typeName, taxonomyType] of Object.entries(registry.taxonomy_types)) {
    const repo = repos[typeName]
    if (!repo) continue

    const programmatic = taxonomyType.fields
      .filter((f) => f.field_type === 'programmatic')
      .map((f) => f.name)

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
      const data = await respondList(result.data as Record<string, unknown>[], typeName, programmatic)
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
      const data = await respondItem(item as Record<string, unknown>, typeName, programmatic)
      return c.json({ ok: true, data })
    })
  }
}
