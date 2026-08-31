import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { FieldKeyMap } from './field-keys.js'

// ─── Recursive outbound projection ────────────────────────────────────────────
//
// Stage 1 mapped a response row's TOP-LEVEL keys from storage columns to public
// labels. Nested rows — paragraph children, resolved reference and junction
// targets — were attached straight from SELECT * and never mapped, so they
// served column names. This walks them.
//
// Applied at exactly the points that called FieldKeyMap.toLabels before, which
// is why it fixes both the public and admin paths without touching either
// resolver: both already map at the right moment, after relation resolution.
//
// GraphQL does not use this. It resolves each field individually by column
// through resolveFieldValue, so it is already correct at every depth.

/**
 * Is this a resolved row worth recursing into? A relation that was not
 * `?include=`d holds a bare uuid string (or an array of them), and timestamps
 * arrive from the driver as Date instances — neither is a row.
 */
export function isPlainRow(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}

export type TypeProjector = {
  /** This type's own label↔column map. */
  map: FieldKeyMap
  /** Relation fields worth recursing into: the field's LABEL and its target type. */
  nested: Array<{ label: string; target: string }>
}

export type Projectors = Record<string, TypeProjector>

// Media relations resolve to rows of the `media` system table — fixed columns,
// no schema fields — so there is nothing to project and they stay out of `nested`.
const MEDIA_FIELD_TYPES = new Set(['image', 'video', 'file'])

function nestedTargets(fields: ParsedField[]): Array<{ label: string; target: string }> {
  const out: Array<{ label: string; target: string }> = []
  for (const f of fields) {
    if (MEDIA_FIELD_TYPES.has(f.field_type)) continue
    if (f.field_type !== 'paragraph' && f.field_type !== 'reference') continue
    // Both kinds name their target the same way.
    const ref = (f.ui_component as { ref?: string }).ref
    if (!ref) continue
    out.push({ label: f.name, target: ref })
  }
  return out
}

/**
 * Built ONCE at startup, not per request. Covers content, taxonomy and
 * paragraph types, keyed by machine name — the same key space `fieldKeyMaps`
 * uses and the same one a field's `ui_component.ref` points into.
 */
export function buildProjectors(
  registry: SchemaRegistry,
  fieldKeyMaps: Record<string, FieldKeyMap>
): Projectors {
  const projectors: Projectors = {}
  const sources: Array<Record<string, { fields: ParsedField[] }>> = [
    registry.content_types,
    registry.taxonomy_types,
    registry.paragraph_types,
  ]

  for (const source of sources) {
    for (const [typeName, type] of Object.entries(source)) {
      const map = fieldKeyMaps[typeName]
      if (!map) continue
      projectors[typeName] = { map, nested: nestedTargets(type.fields) }
    }
  }

  return projectors
}

/**
 * Storage-keyed row → label-keyed, recursively. Never mutates its input: the
 * relation cache hands the SAME nested object to several parents, so editing in
 * place would project a shared row twice and lose its values on the second pass.
 */
export function projectRow(
  row: Record<string, unknown>,
  typeName: string,
  projectors: Projectors
): Record<string, unknown> {
  const p = projectors[typeName]
  if (!p) return row

  // Top level first: `nested` is keyed by label, so the keys must be labels
  // before the loop below reads them. toLabels returns a fresh object.
  const out = p.map.toLabels(row)

  for (const { label, target } of p.nested) {
    const v = out[label]
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      out[label] = v.map((item) => (isPlainRow(item) ? projectRow(item, target, projectors) : item))
    } else if (isPlainRow(v)) {
      out[label] = projectRow(v, target, projectors)
    }
  }

  return out
}
