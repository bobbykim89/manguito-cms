// packages/core/src/versions/validate.ts
import type { ParseError } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { VersionProjection, VersionSnapshot } from './types.js'
import { isColumnBacked } from '../registry/columns.js'

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Which of a registry's type maps to read. Defaults to the two that back
 * `VersionProjection` — content and taxonomy. Paragraph types are read
 * separately, and only by the completeness check's paragraph arm below: they
 * are deliberately excluded from projections (see that arm's comment), so
 * every OTHER check in this file must keep reading only the structural two —
 * passing kinds explicitly, rather than silently widening every caller, is
 * what keeps that boundary from eroding by accident.
 */
type TypeKind = 'content_types' | 'taxonomy_types' | 'paragraph_types'
const STRUCTURAL_KINDS: TypeKind[] = ['content_types', 'taxonomy_types']

/** Every type in the given map(s) of a registry, as [name, fields] pairs. */
function typeEntries(
  registry: SchemaRegistry,
  kinds: TypeKind[] = STRUCTURAL_KINDS
): Array<[string, ParsedField[]]> {
  const out: Array<[string, ParsedField[]]> = []
  for (const kind of kinds) {
    for (const [name, type] of Object.entries(registry[kind])) {
      out.push([name, type.fields])
    }
  }
  return out
}

/** Per type, its column-backed fields keyed by column. Tombstones included — they hold a real column. */
function fieldsByColumn(
  registry: SchemaRegistry,
  kinds: TypeKind[] = STRUCTURAL_KINDS
): Map<string, Map<string, ParsedField>> {
  const out = new Map<string, Map<string, ParsedField>>()
  for (const [typeName, fields] of typeEntries(registry, kinds)) {
    const byColumn = new Map<string, ParsedField>()
    for (const f of fields) {
      if (!isColumnBacked(f)) continue
      byColumn.set(f.db_column!.column_name, f)
    }
    out.set(typeName, byColumn)
  }
  return out
}

// ─── VERSION_COLUMN_MISSING ─────────────────────────────────────────────────
//
// Every column a live version's projection exposes must exist in the union.
//
// This is what the derived model needed AMBIGUOUS_RENAME's heuristic for, and
// it is strictly stronger: it checks a PRESENCE — is this column in the union?
// — instead of interpreting an ABSENCE — did this name disappear because of an
// undeclared rename, or an intentional deletion? There is nothing to guess, so
// there is nothing to confirm either, which is why `pending.json`'s `drops`
// array has no successor.
//
// It is also what makes `union === current` sound, and what closes the derived
// model's two retention gaps: a type current deleted, and a paragraph type's
// own column, are no longer things the model tries to reconstruct — the author
// is required to keep them, and told so here.
function checkUnionCompleteness(input: {
  union: SchemaRegistry
  projections: Record<string, VersionProjection>
  currentVersion: string
  snapshots: VersionSnapshot[]
}): ParseError[] {
  const { union, projections, currentVersion, snapshots } = input
  const errors: ParseError[] = []
  const unionColumns = fieldsByColumn(union)

  for (const [version, projection] of Object.entries(projections)) {
    // Current's projection is a read of the union itself, so it is complete by
    // construction — checking it would be vacuous.
    if (version === currentVersion) continue

    for (const [typeName, type] of Object.entries(projection.types)) {
      const columns = unionColumns.get(typeName)

      if (columns === undefined) {
        // The whole type is gone from current. Reported once per type rather
        // than once per field: the fix is the same for all of them.
        errors.push({
          file: `schemas/versions/${version}`,
          code: 'VERSION_COLUMN_MISSING',
          message:
            `Live version ${version} exposes type "${typeName}", which the current schema no longer ` +
            `defines. Every column a live version serves must still exist. Keep "${typeName}" in the ` +
            `current schema with its fields marked "removed": true, or retire ${version} by deleting ` +
            `schemas/versions/${version}.`,
        })
        continue
      }

      for (const f of type.fields) {
        if (columns.has(f.column_name)) continue
        errors.push({
          file: `schemas/versions/${version}`,
          code: 'VERSION_COLUMN_MISSING',
          message:
            `Live version ${version} exposes column "${f.column_name}" on "${typeName}" (as ` +
            `"${f.exposed_as}"), which the current schema neither exposes nor retains. Either add ` +
            `"column": "${f.column_name}" to the field that replaced it, or add a field ` +
            `{ "name": "${f.exposed_as}", "removed": true } to retain the column while ${version} ` +
            `is live.`,
        })
      }
    }
  }

  // ─── Paragraph arm ─────────────────────────────────────────────────────
  //
  // Paragraph types stay out of `VersionProjection` on purpose — a paragraph
  // row is a polymorphic child, and whether it belongs in the versioned API
  // contract is a genuinely undesigned question for a later sub-project. That
  // is why this arm cannot walk `projections` the way the loop above does:
  // there is nothing there to walk. So it compares each snapshot's
  // `paragraph_types` directly against the union's (`=== current`'s) —
  // registry to registry — the way the retired `checkUnretainableLiveSurface`
  // did, bypassing projections entirely.
  //
  // Column retention is not undesigned, though: a live snapshot's paragraph
  // type still has column-backed fields, and if current drops one without a
  // tombstone, db codegen drops a column that snapshot's paragraph rows still
  // read. That is exactly the completeness gap this arm closes.
  const paragraphColumns = fieldsByColumn(union, ['paragraph_types'])

  for (const snap of snapshots) {
    for (const [typeName, fields] of typeEntries(snap.registry, ['paragraph_types'])) {
      const columns = paragraphColumns.get(typeName)

      if (columns === undefined) {
        // Whole type gone, reported once — same shape as the structural arm.
        errors.push({
          file: `schemas/versions/${snap.version}`,
          code: 'VERSION_COLUMN_MISSING',
          message:
            `Live version ${snap.version} exposes paragraph type "${typeName}", which the current ` +
            `schema no longer defines. Every column a live version serves must still exist. Keep ` +
            `"${typeName}" in the current schema with its fields marked "removed": true, or retire ` +
            `${snap.version} by deleting schemas/versions/${snap.version}.`,
        })
        continue
      }

      for (const f of fields) {
        // Only column-backed fields can be retained at all — a paragraph
        // type's own `paragraph` or many-to-many field has no column, and a
        // field the snapshot itself already tombstoned exposes nothing to
        // retain.
        if (!isColumnBacked(f) || f.removed === true) continue
        const column = f.db_column!.column_name
        if (columns.has(column)) continue

        errors.push({
          file: `schemas/versions/${snap.version}`,
          code: 'VERSION_COLUMN_MISSING',
          message:
            `Live version ${snap.version} exposes column "${column}" on paragraph type "${typeName}" ` +
            `(as "${f.name}"), which the current schema neither exposes nor retains. Either add ` +
            `"column": "${column}" to the field that replaced it, or add a field ` +
            `{ "name": "${f.name}", "removed": true } to retain the column while ${snap.version} is live.`,
        })
      }
    }
  }

  return errors
}

// ─── ORPHANED_TOMBSTONE ─────────────────────────────────────────────────────
//
// A tombstone emits a real column into the union, so one that NO live version
// exposes is a column nothing can ever read — the residue of a retirement
// whose tombstone was not deleted alongside the snapshot directory.
//
// Rejecting it is what keeps retirement from silently accumulating dead
// columns, and it is only checkable because retention is stated: the derived
// model could not tell a deliberately retained column from one left over,
// which is exactly why its history could never be pruned.
function checkOrphanedTombstones(input: {
  current: SchemaRegistry
  projections: Record<string, VersionProjection>
  currentVersion: string
}): ParseError[] {
  const { current, projections, currentVersion } = input
  const errors: ParseError[] = []

  // Every (type, column) some version OTHER than current exposes.
  const exposed = new Set<string>()
  for (const [version, projection] of Object.entries(projections)) {
    if (version === currentVersion) continue
    for (const [typeName, type] of Object.entries(projection.types)) {
      for (const f of type.fields) exposed.add(`${typeName}.${f.column_name}`)
    }
  }

  for (const [typeName, fields] of typeEntries(current)) {
    for (const f of fields) {
      if (f.removed !== true || !isColumnBacked(f)) continue
      if (exposed.has(`${typeName}.${f.db_column!.column_name}`)) continue
      errors.push({
        file: current.schemas[typeName]?.source_file ?? '',
        code: 'ORPHANED_TOMBSTONE',
        message:
          `Field "${f.name}" on "${typeName}" is marked "removed": true, retaining column ` +
          `"${f.db_column!.column_name}", but no live version exposes that column any more. It is a ` +
          `column nothing can read. Delete the field — that shrinks the union and lets db codegen ` +
          `drop the column.`,
      })
    }
  }

  return errors
}

// ─── FIELD_TYPE_CHANGED_WHILE_LIVE ──────────────────────────────────────────
//
// One column cannot hold two types, so a live version's contract cannot change
// type under its consumers. Matched by COLUMN, not by name: a renamed field's
// old name no longer exists, and matching by name would miss precisely the case
// versioning exists to handle.
function checkFieldTypeChangedWhileLive(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
}): ParseError[] {
  const { current, snapshots } = input
  const errors: ParseError[] = []
  const currentByType = fieldsByColumn(current)

  for (const snap of snapshots) {
    for (const [typeName, snapColumns] of fieldsByColumn(snap.registry)) {
      const currentColumns = currentByType.get(typeName)
      if (!currentColumns) continue // the whole type is gone — VERSION_COLUMN_MISSING's concern

      for (const [col, oldField] of snapColumns) {
        const currentField = currentColumns.get(col)
        if (!currentField) continue // absent — VERSION_COLUMN_MISSING's concern, not this one's
        if (currentField.field_type === oldField.field_type) continue

        errors.push({
          file: `schemas/versions/${snap.version}`,
          code: 'FIELD_TYPE_CHANGED_WHILE_LIVE',
          message:
            `Column "${col}" on "${typeName}" is exposed by live version ${snap.version} as ` +
            `${oldField.field_type}, but the current schema now types it ${currentField.field_type}. ` +
            `A live version's contract cannot change type under its consumers — retire ` +
            `${snap.version} first, or keep the field's type stable and introduce the change as a ` +
            `new column instead.`,
        })
      }
    }
  }

  return errors
}

// ─── validateVersionModel ───────────────────────────────────────────────────

/**
 * Takes the BUILT union and projections, unlike the derived model's validator,
 * which ran first and rebuilt what it needed. A projection is now a pure read
 * of one version's own schema files — it cannot be wrong, only incomplete, and
 * checking that is what reading the built projections is for.
 */
export function validateVersionModel(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  union: SchemaRegistry
  projections: Record<string, VersionProjection>
}): ParseError[] {
  return [
    ...checkUnionCompleteness(input),
    ...checkOrphanedTombstones(input),
    ...checkFieldTypeChangedWhileLive(input),
  ]
}
