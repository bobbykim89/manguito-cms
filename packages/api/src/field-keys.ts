import type { DbColumn, ParsedField } from '@bobbykim/manguito-cms-core'

// ─── Label ↔ storage key mapping ──────────────────────────────────────────────
//
// A field has two names: its public LABEL (`field.name`, what API consumers and
// the admin panel see) and its STORAGE key (`db_column.column_name`, the actual
// Postgres column). They are identical today, but schema versioning makes a
// rename change only the label — the column keeps its original name for the life
// of the data. Every place that reads or writes a DB row must therefore use the
// storage key, and every place that reads a request body or writes a response
// must use the label.
//
// Only column-backed fields participate. Paragraph fields have no column
// (their association lives on the paragraph table via parent_field) and
// many-to-many references have no column either (the junction table owns the
// association), so both keep the field name as their identity and are excluded.

// A type predicate, not a plain boolean: narrowing `db_column` to non-null lets
// the compiler enforce the invariant at every call site instead of each one
// re-asserting it with `db_column!`.
export function isColumnBacked(field: ParsedField): field is ParsedField & { db_column: DbColumn } {
  const col = field.db_column
  if (col === null) return false
  if (col.column_name === '') return false
  if (col.junction) return false
  return true
}

export type FieldKeyMap = {
  /** Request body (label-keyed) → storage-keyed. Unknown keys pass through. */
  toStorage(input: Record<string, unknown>): Record<string, unknown>
  /** DB row (storage-keyed) → label-keyed. Unknown keys pass through. */
  toLabels(row: Record<string, unknown>): Record<string, unknown>
  columnFor(label: string): string | undefined
  labelFor(column: string): string | undefined
  /** Labels of column-backed fields — the valid filter/sort surface. */
  labels: string[]
  /** False when every label equals its column, letting callers skip the copy. */
  diverges: boolean
}

/**
 * Built ONCE per content type at startup, not per request. Throws on a key
 * collision, matching how createCmsApp refuses to boot on a broken roles
 * registry: an ambiguous mapping would silently corrupt responses.
 *
 * Tombstones (`field.removed === true`) are column-backed — the parser keeps
 * their column alive for older live versions — but the CURRENT version must
 * never serve or accept them. They are excluded from `labelToColumn` and the
 * public `columnToLabel` below, and additionally dropped by key in `remap`:
 * without that second step, an unmapped retained column would pass through
 * `remap` unchanged (see the comment on `remap`) and reach the response under
 * its raw column name.
 */
export function createFieldKeyMap(fields: ParsedField[]): FieldKeyMap {
  const labelToColumn = new Map<string, string>()
  // Includes tombstoned columns until the collision check below has run —
  // see the trap note there before touching this map.
  const columnToLabel = new Map<string, string>()
  // Both the name and the column of every tombstone, so remap can drop a
  // tombstone under either key. They differ when a field was renamed and
  // THEN removed: it carries both `column` (the original, still-live column)
  // and `removed`.
  const droppedKeys = new Set<string>()

  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    columnToLabel.set(f.db_column.column_name, f.name)
    if (f.removed === true) {
      droppedKeys.add(f.name)
      droppedKeys.add(f.db_column.column_name)
      continue
    }
    labelToColumn.set(f.name, f.db_column.column_name)
  }

  // A label that is also some OTHER field's column name would make toLabels
  // ambiguous: two source keys would map onto one destination key.
  //
  // Checked against EVERY field's label, not just the column-backed subset.
  // Paragraph, many-to-many and programmatic fields have no column of their
  // own, but their labels are written into the same key space as storage
  // columns before toLabels runs (routes/admin/content.ts, relations.ts,
  // programmatic/resolve.ts). A paragraph field named after another field's
  // column would overwrite that column's value on the row and then be renamed
  // onto the other field's label — serving the wrong value under the wrong key.
  //
  // Deliberately run against `columnToLabel` BEFORE tombstoned columns are
  // stripped from it below: a live field's label may collide with a
  // TOMBSTONE's column (the column still physically exists on the row), and
  // that must keep throwing. Stripping tombstones first would silently pass
  // this configuration, and the exclusion step afterward would then delete
  // the live field's column from every response instead of the tombstone's.
  //
  // Not detected: two fields declaring the SAME column name. A field can now
  // declare its own `column`, so this is no longer structurally impossible —
  // but core rejects it with `DUPLICATE_COLUMN` at parse time, so it is still
  // unreachable here.
  for (const f of fields) {
    const columnOwner = columnToLabel.get(f.name)
    if (columnOwner !== undefined && columnOwner !== f.name) {
      throw new Error(
        `Fatal: field key map failed to build — field label "${f.name}" collides with the ` +
          `storage column of field "${columnOwner}". A field label may not reuse another ` +
          `field's column name. Rename the field, then run \`manguito validate\` to check your schema.`
      )
    }
  }

  // Only now strip tombstoned columns — the collision check above has already
  // run against the full map.
  for (const f of fields) {
    if (isColumnBacked(f) && f.removed === true) {
      columnToLabel.delete(f.db_column.column_name)
    }
  }

  const diverges = [...labelToColumn].some(([label, column]) => label !== column)

  function remap(
    input: Record<string, unknown>,
    lookup: Map<string, string>
  ): Record<string, unknown> {
    // Always returns a NEW object, even when nothing diverges. Returning `input`
    // unchanged would make aliasing depend on the schema, so a bug where a
    // caller mutates a row after mapping would reproduce only on renamed
    // fields. A shallow copy per row is not worth that class of bug.
    //
    // Unknown keys pass through unchanged — which is exactly why a tombstone
    // key must be checked and skipped explicitly here, rather than relying on
    // its absence from `lookup`: absence alone would let it pass through under
    // its raw key instead of being dropped.
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(input)) {
      if (droppedKeys.has(key)) continue
      out[lookup.get(key) ?? key] = input[key]
    }
    return out
  }

  return {
    toStorage: (input) => remap(input, labelToColumn),
    toLabels: (row) => remap(row, columnToLabel),
    columnFor: (label) => labelToColumn.get(label),
    labelFor: (column) => columnToLabel.get(column),
    labels: [...labelToColumn.keys()],
    diverges,
  }
}
