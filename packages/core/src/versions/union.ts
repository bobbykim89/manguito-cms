import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { PendingChanges, VersionHistory, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'

// Only column-backed fields participate. Paragraph fields have no column, and
// many-to-many references have none either (the junction table owns the
// association) — both keep the label as their identity.
// Exported: Task 4's projections use the same predicate and must not redeclare it.
export function isColumnBacked(field: ParsedField): boolean {
  const col = field.db_column
  return col !== null && col.column_name !== '' && !col.junction
}

/**
 * Unions one type map (content_types or taxonomy_types) in place of a plain
 * merge: current's fields first (so its ordering wins), then any column an
 * older snapshot exposed that current no longer does — retained and forced
 * nullable, since rows created after the drop cannot populate it.
 */
function unionTypeMap<T extends { fields: ParsedField[] }>(
  currentMap: Record<string, T>,
  snapshotMapOf: (snap: VersionSnapshot) => Record<string, T> | undefined,
  snapshots: VersionSnapshot[],
  currentVersion: string,
  live: string[],
  history: VersionHistory,
  pending: PendingChanges
): Record<string, T> {
  const result: Record<string, T> = { ...currentMap }

  for (const [typeName, type] of Object.entries(currentMap)) {
    const seen = new Set<string>()
    const fields: ParsedField[] = []

    for (const f of type.fields) {
      if (!isColumnBacked(f)) {
        fields.push(f)
        continue
      }
      // The parser has no version awareness, so a field freshly parsed under
      // its current label always reports that label as its column too. The
      // fold recovers the field's actual column — its label in the earliest
      // version that ever contained it — which is what the union keys by.
      const col = columnOf({
        label: f.name, type: typeName, version: currentVersion,
        live, history, pending, current: currentVersion,
      })
      seen.add(col)
      fields.push(col === f.db_column!.column_name ? f : { ...f, db_column: { ...f.db_column!, column_name: col } })
    }

    for (const snap of snapshots) {
      const snapType = snapshotMapOf(snap)?.[typeName]
      if (!snapType) continue
      for (const f of snapType.fields) {
        if (!isColumnBacked(f)) continue
        const col = columnOf({
          label: f.name, type: typeName, version: snap.version,
          live, history, pending, current: currentVersion,
        })
        if (seen.has(col)) continue
        seen.add(col)
        // Retained: present in an older version, absent from current.
        fields.push({
          ...f,
          db_column: { ...f.db_column!, column_name: col, nullable: true },
        })
      }
    }

    result[typeName] = { ...type, fields }
  }

  return result
}

/**
 * Every live version's fields merged, keyed by COLUMN. A column current no
 * longer exposes is retained and forced nullable: rows created after the drop
 * cannot populate it, so a NOT NULL would be unsatisfiable.
 */
export function buildUnionRegistry(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): SchemaRegistry {
  const { current, currentVersion, snapshots, live, history, pending } = input
  if (snapshots.length === 0) return current

  return {
    ...current,
    content_types: unionTypeMap(
      current.content_types,
      (snap) => snap.registry.content_types,
      snapshots, currentVersion, live, history, pending
    ),
    taxonomy_types: unionTypeMap(
      current.taxonomy_types,
      (snap) => snap.registry.taxonomy_types,
      snapshots, currentVersion, live, history, pending
    ),
  }
}
