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
 * One field's place in the label space: the label it is known by, plus the
 * storage column it owns. `ownColumn` is ABSENT — never present-and-undefined,
 * per exactOptionalPropertyTypes — for a field with no column of its own.
 */
type LabelEntry = { label: string; ownColumn?: string }

/**
 * The shared core: given a label↔column mapping and the FULL label space to
 * check against, produce a FieldKeyMap. Both `createFieldKeyMap` and
 * `createFieldKeyMapFromProjection` are thin adapters over this — the
 * collision check, the `diverges` computation and `remap` live here exactly
 * once.
 *
 * `pairs` may include entries that must NOT survive into the final map —
 * `createFieldKeyMap` passes tombstoned columns in alongside live ones,
 * exactly as the original single-function implementation did, so that the
 * collision check below (which runs against the unfiltered map) still
 * catches a live field's label colliding with a TOMBSTONE's column. Any
 * pair whose label or column appears in `droppedKeys` is stripped from
 * `labelToColumn`/`columnToLabel` immediately after the check, before
 * `diverges` and `labels` are computed — so the caller does not need to
 * pre-filter `pairs` itself, only tell this function what to drop.
 *
 * `allLabels` is every field's label, including fields with no column of
 * their own. That is not tidiness: a paragraph, many-to-many or programmatic
 * field's label is written into the same key space as storage columns before
 * `toLabels` runs, so one named after another field's column would overwrite
 * that column's value and then be renamed onto the other field's label.
 * Both constructors must pass the complete set.
 *
 * Each entry carries `ownColumn` — the column that field itself is backed by,
 * absent for a paragraph, many-to-many or programmatic field. The collision
 * check below needs it: a label that equals a column is a collision only when
 * the column belongs to a DIFFERENT field, and strings alone cannot tell the
 * two apart.
 *
 * `droppedKeys` also drives `remap`: it must actively remove a key from a
 * mapped object rather than merely leave it unmapped, because `remap` passes
 * an unmapped key through unchanged — a retained-but-unexposed column would
 * otherwise reach the output under its raw name.
 */
function buildFieldKeyMap(
  pairs: Array<{ label: string; column: string }>,
  allLabels: LabelEntry[],
  droppedKeys: Set<string>
): FieldKeyMap {
  const labelToColumn = new Map<string, string>()
  const columnToLabel = new Map<string, string>()
  for (const { label, column } of pairs) {
    labelToColumn.set(label, column)
    columnToLabel.set(column, label)
  }

  // A label that is also some OTHER field's column name would make toLabels
  // ambiguous: two source keys would map onto one destination key.
  //
  // Checked against EVERY label in `allLabels`, not just the ones with a
  // pair of their own. Paragraph, many-to-many and programmatic fields have
  // no column of their own, but their labels are written into the same key
  // space as storage columns before toLabels runs (routes/admin/content.ts,
  // relations.ts, programmatic/resolve.ts). A paragraph field named after
  // another field's column would overwrite that column's value on the row
  // and then be renamed onto the other field's label — serving the wrong
  // value under the wrong key.
  //
  // Deliberately run BEFORE dropped pairs are stripped from `columnToLabel`
  // below: a live field's label may collide with a TOMBSTONE's column (the
  // column still physically exists on the row), and that must keep
  // throwing. Stripping first would silently pass this configuration, and
  // the exclusion step afterward would then delete the live field's column
  // from every response instead of the tombstone's.
  //
  // Not detected: two fields declaring the SAME column name. A field can now
  // declare its own `column`, so this is no longer structurally impossible —
  // but core rejects it with `DUPLICATE_COLUMN` at parse time, so it is still
  // unreachable here.
  for (const { label, ownColumn } of allLabels) {
    // The label is this field's OWN column, exposed by this version under a
    // different name. That is not an ambiguity — it is one field seen twice,
    // under current's name and under the label this version uses — and there
    // is still exactly one column holding exactly one value. It happens when a
    // field is renamed away and then renamed BACK onto its column's name while
    // the intermediate version is still live. Without this skip the map refuses
    // to build and createCmsApp throws at startup for every version at once.
    //
    // Only the SAME field is exempted: `ownColumn` is absent for a field with
    // no column of its own (a paragraph, many-to-many or programmatic field's
    // label named after some other field's column is precisely the ambiguity
    // this check exists for), and differs from `label` when the name belongs to
    // one field while the column belongs to another.
    if (ownColumn === label) continue
    const columnOwner = columnToLabel.get(label)
    if (columnOwner !== undefined && columnOwner !== label) {
      throw new Error(
        `Fatal: field key map failed to build — field label "${label}" collides with the ` +
          `storage column of field "${columnOwner}". A field label may not reuse another ` +
          `field's column name. Rename the field, then run \`manguito validate\` to check your schema.`
      )
    }
  }

  // Only now strip dropped pairs — the collision check above has already run
  // against the full map. A dropped pair is removed from BOTH maps: from
  // `labelToColumn` by its label, from `columnToLabel` by its column.
  for (const label of labelToColumn.keys()) {
    if (droppedKeys.has(label)) labelToColumn.delete(label)
  }
  for (const column of columnToLabel.keys()) {
    if (droppedKeys.has(column)) columnToLabel.delete(column)
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
    // Unknown keys pass through unchanged — which is exactly why a dropped
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

/**
 * Built ONCE per content type at startup, not per request. Throws on a key
 * collision, matching how createCmsApp refuses to boot on a broken roles
 * registry: an ambiguous mapping would silently corrupt responses.
 *
 * Tombstones (`field.removed === true`) are column-backed — the parser keeps
 * their column alive for older live versions — but the CURRENT version must
 * never serve or accept them. Their pair is passed into the shared core
 * alongside the live ones (so the collision check below still sees them —
 * see `buildFieldKeyMap`'s doc comment), and then stripped from the returned
 * map via `droppedKeys` — which also drives `remap`: without that, an
 * unmapped retained column would pass through `remap` unchanged and reach
 * the response under its raw column name.
 */
export function createFieldKeyMap(fields: ParsedField[]): FieldKeyMap {
  // Both the name and the column of every tombstone, so the shared core can
  // strip a tombstone under either key. They differ when a field was renamed
  // and THEN removed: it carries both `column` (the original, still-live
  // column) and `removed`.
  const droppedKeys = new Set<string>()
  const pairs: Array<{ label: string; column: string }> = []

  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    // Keyed by `f.name` for every column-backed field, live or tombstoned, so
    // buildFieldKeyMap's post-check stripping (which deletes from
    // `labelToColumn` by the labels in `droppedKeys`) can find and remove a
    // tombstone's own entry. That leans on field names being unique across
    // live and tombstoned fields within one type — true today (core rejects
    // a duplicate name at parse time) but only load-bearing here because this
    // refactor now writes a tombstone's pair into the shared map at all; the
    // original single-function implementation `continue`d past a tombstone
    // before ever writing one, so the collision was structurally impossible.
    pairs.push({ label: f.name, column: f.db_column.column_name })
    if (f.removed === true) {
      droppedKeys.add(f.name)
      droppedKeys.add(f.db_column.column_name)
    }
  }

  // `ownColumn` is a strict no-op on this path and is passed only so the two
  // constructors share one core: here a label IS a field's name, so a field
  // whose own column equals its name already maps that column back to itself
  // (`columnOwner === label`) and never reached the throw. It matters only for
  // a projection, which can expose a column under some other label.
  return buildFieldKeyMap(
    pairs,
    fields.map((f) => ({
      label: f.name,
      // Conditional spread, not a plain assignment — exactOptionalPropertyTypes
      // forbids present-and-undefined.
      ...(isColumnBacked(f) && { ownColumn: f.db_column.column_name }),
    })),
    droppedKeys
  )
}

/**
 * From a version's projection. The projection is already the label↔column
 * mapping and already excludes tombstones and non-column-backed fields, so
 * there is nothing to filter — but the collision check still needs every
 * field's label, which is why `allFields` is required.
 */
export function createFieldKeyMapFromProjection(
  projectionType: { fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }> },
  allFields: ParsedField[]
): FieldKeyMap {
  const pairs = projectionType.fields.map((f) => ({ label: f.exposed_as, column: f.column_name }))
  const projected = new Set(pairs.map((p) => p.label))
  // Every column-backed field this projection does NOT expose must be
  // actively dropped — not just tombstones. A tombstone's column is one way
  // a column can be absent from the projection, but it is not the only one:
  // a field added to the CURRENT schema after this version was cut is live
  // (`removed !== true`) and is just as absent from an older version's
  // projection, and `remap` passes an unknown key through unchanged — so
  // without this, a column added later would leak into every older live
  // version's response straight off `SELECT *`. Building the drop-set from
  // "every column-backed field, then un-drop what this projection exposes"
  // subsumes the tombstone case instead of special-casing it.
  const dropped = new Set<string>()
  for (const f of allFields) {
    if (!isColumnBacked(f)) continue
    dropped.add(f.name)
    dropped.add(f.db_column.column_name)
  }
  // A column this version DOES expose must not be dropped — protects both a
  // retained tombstone column (the original case) and a column that is live
  // in the current schema but simply predates this version (the general case
  // above). Same for its label.
  for (const p of pairs) dropped.delete(p.column)
  for (const label of projected) dropped.delete(label)

  return buildFieldKeyMap(
    pairs,
    allFields.map((f) => ({
      label: f.name,
      // See buildFieldKeyMap's collision check: this is what lets it tell a
      // version exposing a field's own column under a new label (fine) from a
      // label that reuses another field's column (not fine).
      ...(isColumnBacked(f) && { ownColumn: f.db_column.column_name }),
    })),
    dropped
  )
}
