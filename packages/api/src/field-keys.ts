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
 */
export function createFieldKeyMap(fields: ParsedField[]): FieldKeyMap {
  const labelToColumn = new Map<string, string>()
  const columnToLabel = new Map<string, string>()

  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    labelToColumn.set(f.name, f.db_column.column_name)
    columnToLabel.set(f.db_column.column_name, f.name)
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
  // Not detected: two fields declaring the SAME column name. That is
  // unreachable from the parser, which derives every column from its own field.
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

  const diverges = [...labelToColumn].some(([label, column]) => label !== column)

  function remap(
    input: Record<string, unknown>,
    lookup: Map<string, string>
  ): Record<string, unknown> {
    // Always returns a NEW object, even when nothing diverges. Returning `input`
    // unchanged would make aliasing depend on the schema, so a bug where a
    // caller mutates a row after mapping would reproduce only on renamed
    // fields. A shallow copy per row is not worth that class of bug.
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(input)) {
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
