import type { ParsedField, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { isColumnBacked } from '../field-keys.js'

// ─── One live version's view of the schema ────────────────────────────────────
//
// A VersionProjection says WHICH columns a version exposes, under WHICH labels,
// and whether each is required. It deliberately says nothing about a field's
// type: `field_type` and `ui_component` are recovered from CURRENT's field for
// the same column instead.
//
// That join is sound, not convenient. `VERSION_COLUMN_MISSING` guarantees every
// column a live version exposes still exists in current, and
// `FIELD_TYPE_CHANGED_WHILE_LIVE` guarantees its type has not moved under it —
// so current's field is a faithful source for everything except the label and
// the requiredness, which the projection carries precisely because they DO
// move. See the 2e design, "Deriving a version's types".

export type ViewField = {
  /** Current's field for this column — the source of `field_type` and `ui_component`. */
  field: ParsedField
  /** The name THIS version exposes the column under. */
  exposedAs: string
  /** THIS version's requiredness. Never current's — see VersionProjection. */
  required: boolean
  /**
   * The value to serve when the column holds null, for a column that stopped
   * being written. REST substitutes this in `projectRow`; GraphQL has no
   * route-level projection, so its scalar resolver has to do it or the two
   * surfaces disagree about the same version's contract.
   */
  fallback?: unknown
  /** Present only when this version's contract differs from current's. */
  deprecationReason?: string
}

/** Keyed by machine name, for content, taxonomy AND paragraph types. */
export type VersionView = Record<string, { fields: ViewField[] }>

/** A type's column-backed fields keyed by column. Tombstones included — they hold a real column. */
function byColumn(fields: ParsedField[]): Map<string, ParsedField> {
  const out = new Map<string, ParsedField>()
  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    out.set(f.db_column.column_name, f)
  }
  return out
}

/**
 * Why this version's contract differs from current's, or undefined when it
 * does not. Keyed by COLUMN, because the label is exactly what may have moved.
 *
 * The reason names CURRENT, not the intermediate version where the change
 * happened: pinpointing that would mean walking every snapshot in between, and
 * "what it is called now" is the actionable fact for someone deciding whether
 * to upgrade.
 */
function deprecationFor(
  field: { column_name: string; exposed_as: string },
  currentLabels: Map<string, string>,
  currentVersion: string
): string | undefined {
  const currentLabel = currentLabels.get(field.column_name)
  if (currentLabel === undefined) {
    return `Removed in ${currentVersion}; column retained while this version is live.`
  }
  if (currentLabel !== field.exposed_as) {
    return `Renamed to '${currentLabel}' in ${currentVersion}.`
  }
  return undefined
}

/**
 * `projection` undefined means this version has no projection for a type — or
 * none at all. Those types fall back to the registry's own fields minus
 * tombstones, which is the inherited 2d boundary: paragraph types are never
 * projected, so nested paragraph content follows current's shape on every
 * version, by design.
 */
export function buildVersionView(input: {
  registry: SchemaRegistry
  projection: VersionProjection | undefined
  currentProjection: VersionProjection | undefined
  currentVersion: string
}): VersionView {
  const { registry, projection, currentProjection, currentVersion } = input
  const out: VersionView = {}

  const sources: Array<Record<string, { fields: ParsedField[] }>> = [
    registry.content_types,
    registry.taxonomy_types,
    registry.paragraph_types,
  ]

  for (const source of sources) {
    for (const [typeName, type] of Object.entries(source)) {
      const projectionType = projection?.types[typeName]

      // No projection for this type: follow current, minus tombstones.
      if (projectionType === undefined) {
        out[typeName] = {
          fields: type.fields
            .filter((f) => f.removed !== true)
            .map((f) => ({ field: f, exposedAs: f.name, required: f.required })),
        }
        continue
      }

      const columns = byColumn(type.fields)
      const currentLabels = new Map<string, string>()
      for (const f of currentProjection?.types[typeName]?.fields ?? []) {
        currentLabels.set(f.column_name, f.exposed_as)
      }

      const fields: ViewField[] = []

      for (const pf of projectionType.fields) {
        const field = columns.get(pf.column_name)
        // Unreachable on a model that loaded — VERSION_COLUMN_MISSING rejects
        // it. Skipped rather than thrown so a hand-built baked model cannot
        // take the whole schema down over one field.
        if (field === undefined) continue
        const reason = deprecationFor(pf, currentLabels, currentVersion)
        fields.push({
          field,
          exposedAs: pf.exposed_as,
          required: pf.required,
          ...(pf.fallback !== undefined && { fallback: pf.fallback }),
          ...(reason !== undefined && { deprecationReason: reason }),
        })
      }

      // Fields with no column of their own — paragraph, many-to-many,
      // programmatic — never appear in a projection, so they must be appended
      // from the registry or an older version's schema would silently lose
      // every relation and computed field. They follow current on every
      // version (the 2d boundary), hence no deprecation reason.
      for (const f of type.fields) {
        if (isColumnBacked(f) || f.removed === true) continue
        fields.push({ field: f, exposedAs: f.name, required: f.required })
      }

      out[typeName] = { fields }
    }
  }

  return out
}
