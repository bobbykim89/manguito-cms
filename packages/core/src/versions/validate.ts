import type { ParseError } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { PendingChanges, VersionHistory, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'
import { isColumnBacked } from './union.js'

// ─── Shared lookups ─────────────────────────────────────────────────────────

/** A type's fields, whichever map (content or taxonomy) actually holds it. */
function fieldsOf(registry: SchemaRegistry, type: string): ParsedField[] | undefined {
  return registry.content_types[type]?.fields ?? registry.taxonomy_types[type]?.fields
}

/** Every type name current or any snapshot defines, content and taxonomy alike. */
function allTypeNames(current: SchemaRegistry, snapshots: VersionSnapshot[]): string[] {
  const names = new Set<string>()
  for (const t of Object.keys(current.content_types)) names.add(t)
  for (const t of Object.keys(current.taxonomy_types)) names.add(t)
  for (const snap of snapshots) {
    for (const t of Object.keys(snap.registry.content_types)) names.add(t)
    for (const t of Object.keys(snap.registry.taxonomy_types)) names.add(t)
  }
  return [...names]
}

function findFieldByLabel(registry: SchemaRegistry, type: string, label: string): ParsedField | undefined {
  return fieldsOf(registry, type)?.find((f) => f.name === label)
}

/** column-backed fields of a type, keyed by their fold-derived COLUMN (not label). */
function columnMapOf(
  registry: SchemaRegistry,
  type: string,
  version: string,
  input: { live: string[]; history: VersionHistory; pending: PendingChanges; current: string }
): Map<string, ParsedField> {
  const map = new Map<string, ParsedField>()
  for (const f of fieldsOf(registry, type) ?? []) {
    if (!isColumnBacked(f)) continue
    const col = columnOf({ label: f.name, type, version, ...input })
    map.set(col, f)
  }
  return map
}

// ─── AMBIGUOUS_RENAME ───────────────────────────────────────────────────────
//
// A column present in a live snapshot but absent from current's column set is
// a candidate for an undeclared rename. `columnOf` already folds any declared
// rename chain into a single identity, so if the old label was really renamed
// forward to a label current still exposes, both resolve to the SAME column
// and the column is never "missing" in the first place — condition (b), "no
// rename chain maps it forward," falls out of the column comparison for free
// and needs no separate check.
//
// A missing column is only reported when BOTH:
//   - a column current exposes did NOT exist in that same snapshot (genuinely
//     new, not merely still-present) — this is condition (c)'s "appeared", and
//   - that new column's field_type matches the missing column's field_type —
//     the rest of condition (c).
// Dropping either half turns an ordinary field removal (nothing of matching
// shape appeared) or an unrelated addition (wrong type) into a false alarm.
//
// A drop declared in EITHER history.drops or pending.drops (both keyed
// "<type>.<column>") suppresses the report outright: the ambiguity is
// resolved by hand, not by guessing.
function checkAmbiguousRenames(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  const { current, currentVersion, snapshots, live, history, pending } = input
  const errors: ParseError[] = []
  const foldInput = { live, history, pending, current: currentVersion }

  const droppedKeys = new Set<string>([
    ...history.drops.map((d) => d.field),
    ...pending.drops,
  ])

  for (const typeName of allTypeNames(current, snapshots)) {
    const currentByColumn = columnMapOf(current, typeName, currentVersion, foldInput)
    const currentColumns = new Set(currentByColumn.keys())

    for (const snap of snapshots) {
      const snapByColumn = columnMapOf(snap.registry, typeName, snap.version, foldInput)

      for (const [col, oldField] of snapByColumn) {
        if (currentColumns.has(col)) continue // still exposed (directly or via a declared rename)
        if (droppedKeys.has(`${typeName}.${col}`)) continue // declared drop — not ambiguous

        for (const [newCol, newField] of currentByColumn) {
          if (snapByColumn.has(newCol)) continue // pre-existing, not "appeared"
          if (newField.field_type !== oldField.field_type) continue // condition (c) needs a type match

          errors.push({
            file: 'schemas/versions/pending.json',
            code: 'AMBIGUOUS_RENAME',
            message:
              `Field "${oldField.name}" on "${typeName}" is exposed by ${snap.version} but is gone from the ` +
              `current schema, and a new ${newField.field_type} field "${newField.name}" appeared. This is either a ` +
              `rename or a removal, and the two cannot be told apart.\n` +
              `  If it was renamed, add to schemas/versions/pending.json:\n` +
              `    { "type": "${typeName}", "from": "${oldField.name}", "to": "${newField.name}" }  (under "renames")\n` +
              `  If it was removed, add to schemas/versions/pending.json:\n` +
              `    "${typeName}.${oldField.name}"  (under "drops")`,
          })
        }
      }
    }
  }

  return errors
}

// ─── FIELD_TYPE_CHANGED_WHILE_LIVE ──────────────────────────────────────────
//
// A column a live snapshot still exposes must mean the same thing in current
// as it did there — an old API consumer pinned to that version reads the
// column expecting its old field_type. If the label was renamed but the
// column (fold-derived identity) is unchanged, this still applies; only the
// underlying field_type is compared.
function checkFieldTypeChangedWhileLive(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  const { current, currentVersion, snapshots, live, history, pending } = input
  const errors: ParseError[] = []
  const foldInput = { live, history, pending, current: currentVersion }

  for (const typeName of allTypeNames(current, snapshots)) {
    const currentByColumn = columnMapOf(current, typeName, currentVersion, foldInput)

    for (const snap of snapshots) {
      if (!live.includes(snap.version)) continue

      const snapByColumn = columnMapOf(snap.registry, typeName, snap.version, foldInput)

      for (const [col, oldField] of snapByColumn) {
        const currentField = currentByColumn.get(col)
        if (!currentField) continue // dropped or ambiguous — not this check's concern
        if (currentField.field_type === oldField.field_type) continue

        errors.push({
          file: 'schemas/versions/history.json',
          code: 'FIELD_TYPE_CHANGED_WHILE_LIVE',
          message:
            `Column "${col}" on "${typeName}" is exposed by live version ${snap.version} as ` +
            `${oldField.field_type}, but the current schema now types it ${currentField.field_type}. ` +
            `A live version's contract cannot change type under its consumers — retire ${snap.version} first, ` +
            `or keep the field's type stable and introduce the change as a new column instead.`,
        })
      }
    }
  }

  return errors
}

// ─── UNRENAMEABLE_FIELD_KIND ────────────────────────────────────────────────
//
// The fold only makes sense for column-backed fields — a paragraph field (or
// any field union.ts's isColumnBacked rejects) has no column, so its label
// already IS its identity. A rename entry naming one is never meaningful:
// look the rename's endpoints up across every live registry (whichever side
// still exists tells us the field's kind) and flag it if what's found isn't
// column-backed.
function checkUnrenameableFieldKind(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  const { current, currentVersion, snapshots, history, pending } = input
  const errors: ParseError[] = []

  const registries: SchemaRegistry[] = [current, ...snapshots.map((s) => s.registry)]

  const findByEitherLabel = (type: string, from: string, to: string): ParsedField | undefined => {
    for (const registry of registries) {
      const found = findFieldByLabel(registry, type, from) ?? findFieldByLabel(registry, type, to)
      if (found) return found
    }
    return undefined
  }

  const check = (entry: { type: string; from: string; to: string }, file: string, after: string): void => {
    const field = findByEitherLabel(entry.type, entry.from, entry.to)
    if (!field || isColumnBacked(field)) return // not found is RENAME_CHAIN_BROKEN's concern, not this one's

    errors.push({
      file,
      code: 'UNRENAMEABLE_FIELD_KIND',
      message:
        `Rename after ${after} maps "${entry.from}" → "${entry.to}" on "${entry.type}", but that field is a ` +
        `${field.field_type} field with no backing column. Only column-backed fields can be renamed across ` +
        `versions — a ${field.field_type} field's label already is its identity. Remove the entry.`,
    })
  }

  for (const r of history.renames) check(r, 'schemas/versions/history.json', r.after)
  for (const r of pending.renames) check(r, 'schemas/versions/pending.json', currentVersion)

  return errors
}

// ─── validateVersionModel ────────────────────────────────────────────────────

export function validateVersionModel(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  return [
    ...checkAmbiguousRenames(input),
    ...checkFieldTypeChangedWhileLive(input),
    ...checkUnrenameableFieldKind(input),
  ]
}
