import type { SchemaRegistry } from '../parser/validate.js'
import type { VersionProjection, VersionSnapshot } from './types.js'
import { isColumnBacked } from '../registry/columns.js'

/**
 * Fallbacks declared on CURRENT's tombstones, keyed `"<type>.<column>"`.
 *
 * A fallback is declared where the removal is declared — on current's
 * tombstone, which is what knows the column stopped being written. It is
 * consumed by the OLDER versions' projections: they are the ones still serving
 * that column, to rows created since the removal. Current never exposes it.
 *
 * Keyed by COLUMN, not name: a field renamed and then removed carries both
 * `column` and `removed`, so its name need not match the name any older
 * version exposes the column under.
 */
function collectFallbacks(current: SchemaRegistry): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [typeName, type] of [
    ...Object.entries(current.content_types),
    ...Object.entries(current.taxonomy_types),
  ]) {
    for (const f of type.fields) {
      if (f.fallback === undefined || !isColumnBacked(f)) continue
      out.set(`${typeName}.${f.db_column!.column_name}`, f.fallback)
    }
  }
  return out
}

/**
 * What each live version exposes: per type, each column and the name THAT
 * version exposes it under, plus any fallback.
 *
 * Each version is read from its OWN schema files — a snapshot for a cut
 * version, the working schema for current. No computation spans versions,
 * because every field states its column: that is the entire difference from
 * the derived model, which folded a rename history per field.
 *
 * A tombstone is excluded from the version that declares it — it retains a
 * column for OLDER versions and is not part of this version's contract. Older
 * snapshots have no tombstone for it and go on exposing it.
 */
export function buildProjections(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
}): Record<string, VersionProjection> {
  const { current, currentVersion, snapshots } = input
  const byVersion: Array<{ version: string; registry: SchemaRegistry }> = [
    ...snapshots,
    { version: currentVersion, registry: current },
  ]

  const fallbacks = collectFallbacks(current)
  const out: Record<string, VersionProjection> = {}

  for (const { version, registry } of byVersion) {
    const types: VersionProjection['types'] = {}

    for (const [typeName, type] of [
      ...Object.entries(registry.content_types),
      ...Object.entries(registry.taxonomy_types),
    ]) {
      const fields = type.fields
        .filter((f) => isColumnBacked(f) && f.removed !== true)
        .map((f) => {
          const column_name = f.db_column!.column_name
          const fallback = fallbacks.get(`${typeName}.${column_name}`)
          // Omitted entirely rather than set undefined, so the zero-config
          // case deep-equals cleanly in tests and over the wire.
          return fallback === undefined
            ? { column_name, exposed_as: f.name }
            : { column_name, exposed_as: f.name, fallback }
        })
      types[typeName] = { fields }
    }

    out[version] = { version, types }
  }

  return out
}
