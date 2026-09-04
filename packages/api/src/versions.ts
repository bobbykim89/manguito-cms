import type { ContentRepository, ParsedField, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { createFieldKeyMap, createFieldKeyMapFromProjection, type FieldKeyMap } from './field-keys.js'
import { buildProjectors, type Projectors } from './projector.js'
import { createVersionedPaths, type VersionedPaths } from './paths.js'
import { SORTABLE_FIELDS } from './routes/query-params.js'

// ─── The baked version model ──────────────────────────────────────────────────
//
// What `manguito build` writes into .manguito/version-model.ts and the
// generated server entry passes to createCmsApp.
//
// This is `Omit<VersionModel, 'union'>`. The union IS the current registry
// (`union === current` in core, by reference), and createCmsApp already
// receives that registry — so baking the union too would duplicate the whole
// registry in the generated bundle, and the reference identity that made it
// free in memory does not survive serialization.
export type BakedVersionModel = {
  /** e.g. 'v4' — the working schema's version. */
  current: string
  /** Oldest first, including current. */
  live: string[]
  /** Keyed by version name. */
  projections: Record<string, VersionProjection>
}

export type VersionClass = 'not-a-version' | 'live' | 'retired' | 'unknown'

const VERSION_SEGMENT = /^v\d+$/

function versionNumber(version: string): number {
  return Number.parseInt(version.slice(1), 10)
}

/**
 * What a URL's version segment is.
 *
 * The retired/unknown split is arithmetic on the model alone, with nothing
 * persisted: `current` is the highest snapshot plus one, so a number BELOW it
 * that is not live must have been cut and later retired, while a number at or
 * above it was never cut. A retired version answering 404 would read as "wrong
 * URL" and send a pinned consumer hunting for a typo instead of upgrading.
 *
 * `not-a-version` is load-bearing, not defensive: media stays unversioned, so
 * the catch-all sees `/api/media/:id` too and must fall through for it.
 */
export function classifyVersion(segment: string, model: BakedVersionModel): VersionClass {
  if (!VERSION_SEGMENT.test(segment)) return 'not-a-version'
  if (model.live.includes(segment)) return 'live'
  return versionNumber(segment) < versionNumber(model.current) ? 'retired' : 'unknown'
}

// ─── The version-scoped surface ────────────────────────────────────────────────
//
// Everything one live version needs to serve its own slice of the schema-driven
// public API: its paths (under its own segment, or none for the unversioned
// pass), a field-key map per type, projectors built from those maps, and one
// repository per content/taxonomy type. Task 6 calls this once per live
// version — plus once more for the unversioned pass — and mounts the result.

/**
 * A projection's declared fallbacks, re-keyed for `buildProjectors`: type name
 * → exposed label → fallback value. The projection already keys fallbacks by
 * column (`fallback` sits beside `column_name`/`exposed_as` per field); this
 * flips them onto the label space `TypeProjector.fallbacks` and `projectRow`
 * actually read against.
 */
function fallbacksFor(projection: VersionProjection): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [typeName, type] of Object.entries(projection.types)) {
    const perLabel: Record<string, unknown> = {}
    for (const f of type.fields) {
      if (f.fallback !== undefined) perLabel[f.exposed_as] = f.fallback
    }
    if (Object.keys(perLabel).length > 0) out[typeName] = perLabel
  }
  return out
}

export function buildVersionSurface<Row>(input: {
  /** null = the unversioned pass: paths carry no version segment. */
  version: string | null
  /** Which projection's labels this surface serves. For the unversioned pass,
   * the caller passes `model.current` — the working schema's own labels. */
  projectionVersion: string
  prefix: string
  registry: SchemaRegistry
  model: BakedVersionModel
  /** Injected so this module needs no database import: it stays testable
   * without one, and app.ts keeps ownership of repository construction. */
  makeRepo: (typeName: string, tableName: string, sortableColumns: Set<string>) => ContentRepository<Row>
}): {
  paths: VersionedPaths
  fieldKeyMaps: Record<string, FieldKeyMap>
  projectors: Projectors
  repos: Record<string, ContentRepository<Row>>
} {
  const { version, projectionVersion, prefix, registry, model, makeRepo } = input

  const paths = createVersionedPaths(prefix, version)
  const projection = model.projections[projectionVersion]

  // One map per content, taxonomy AND paragraph type — the same key space
  // `buildProjectors` and `sortableColumnsFor` below both index into.
  //
  // Paragraph types have no projection: core's `buildProjections` iterates
  // content and taxonomy types only. For those, and for any type this
  // projection happens to omit, fall back to the registry's own fields —
  // nested paragraph content follows current's shape on every version, by
  // design, not by oversight.
  const fieldKeyMaps: Record<string, FieldKeyMap> = {}
  const sources: Array<Record<string, { fields: ParsedField[] }>> = [
    registry.content_types,
    registry.taxonomy_types,
    registry.paragraph_types,
  ]
  for (const source of sources) {
    for (const [typeName, type] of Object.entries(source)) {
      const projectionType = projection?.types[typeName]
      fieldKeyMaps[typeName] = projectionType
        ? createFieldKeyMapFromProjection(projectionType, type.fields)
        : createFieldKeyMap(type.fields)
    }
  }

  const fallbacks = projection ? fallbacksFor(projection) : undefined
  const projectors = buildProjectors(registry, fieldKeyMaps, fallbacks)

  // Maps SORTABLE_FIELDS' labels to THIS version's storage columns. A rename
  // moves the column a version sorts by, so this must read the per-version
  // map above, never current's.
  //
  // A label absent from this version's map is EXCLUDED, not passed through
  // as a bogus literal: `columnFor` only returns undefined for a label this
  // type has no field for at all (SORTABLE_FIELDS is shared across every
  // type), or a system field (id/slug/created_at/...), which is not part of
  // the field-key map but is still legitimately sortable — its column IS its
  // own name. Anything else unresolved has no business in the repository's
  // sortable-columns allow-set.
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

  const repos: Record<string, ContentRepository<Row>> = {}
  for (const [typeName, ct] of Object.entries(registry.content_types)) {
    repos[typeName] = makeRepo(typeName, ct.db.table_name, sortableColumnsFor(typeName))
  }
  for (const [typeName, tt] of Object.entries(registry.taxonomy_types)) {
    repos[typeName] = makeRepo(typeName, tt.db.table_name, sortableColumnsFor(typeName))
  }

  return { paths, fieldKeyMaps, projectors, repos }
}

// ─── Deprecation headers ────────────────────────────────────────────────────

/**
 * The headers a response carries, or null for none.
 *
 * Two different mistakes get two different messages: the unversioned path
 * FLOATS and will change under the consumer when a version is cut; an older
 * live version is BEHIND. A consumer on the current version's own path has
 * made neither mistake and gets nothing.
 *
 * The unversioned path stays silent while only one version is live. The
 * warning would be technically true — cutting v2 later does move it — but it
 * is not yet actionable risk, and emitting it would nag every project that
 * never opted into versioning the moment it rebuilt.
 */
export function deprecationHeaders(input: {
  requested: string | null   // null = the unversioned path
  model: BakedVersionModel
  successor: string          // the URL to point at
}): Record<string, string> | null {
  const { requested, model, successor } = input
  const link = `<${successor}>; rel="successor-version"`

  if (requested === null) {
    // Silent while only one version is live: the warning would be technically
    // true, since cutting v2 later does move this path, but it is not yet
    // actionable risk and would nag every project that never opted in.
    if (model.live.length <= 1) return null
    return {
      Deprecation: 'true',
      Link: link,
      Warning:
        `299 - "Unversioned path resolves to the latest version (${model.current}) and will ` +
        `change when a new version is cut. Pin a version."`,
    }
  }

  // A consumer on the current version's own path has made no mistake.
  if (requested === model.current) return null

  return { Deprecation: 'true', Link: link }
}
