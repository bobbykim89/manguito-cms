import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { ParsedSchema } from '../parser/parseSchema.js'
import type { PendingChanges, VersionHistory, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'
import { isColumnBacked } from '../registry/columns.js'

/**
 * Unions one type map (content_types or taxonomy_types) in place of a plain
 * merge: current's fields first (so its ordering wins), then any column an
 * older snapshot exposed that current no longer does — retained and forced
 * nullable, since rows created after the drop cannot populate it.
 */
function unionTypeMap<T extends { fields: ParsedField[] }>(
  currentMap: Record<string, T>,
  snapshotMapOf: (snap: VersionSnapshot) => Record<string, T> | undefined,
  input: {
    currentVersion: string
    snapshots: VersionSnapshot[]
    live: string[]
    history: VersionHistory
    pending: PendingChanges
  }
): Record<string, T> {
  const { currentVersion, snapshots, live, history, pending } = input
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
  // Fast path only when nothing could possibly change a column: no other live
  // version to merge against, and no rename declared anywhere (history or
  // pending). If there are no renames at all, columnOf is the identity for
  // every label, so unionTypeMap would return field objects equal to
  // current's anyway — this is then a pure optimization, not a behavioral
  // shortcut. Once a rename exists, even with zero snapshots (e.g. the
  // renamed version has since retired and only `current` remains live),
  // current's own field may still be labelled differently from its real
  // column, and only unionTypeMap corrects that.
  if (snapshots.length === 0 && history.renames.length === 0 && pending.renames.length === 0) {
    return current
  }

  const shared = { currentVersion, snapshots, live, history, pending }
  const content_types = unionTypeMap(current.content_types, (snap) => snap.registry.content_types, shared)
  const taxonomy_types = unionTypeMap(current.taxonomy_types, (snap) => snap.registry.taxonomy_types, shared)

  // `schemas` is documented as the one source of truth, so it must hold the
  // SAME OBJECTS as the typed maps — not current's unfolded originals. Spreading
  // `...current` and replacing only the two typed maps left
  // `union.schemas[x] === current.schemas[x]`, showing unfolded columns and no
  // retained column, disagreeing with `union.content_types[x]` about the same
  // type. Nothing reads `schemas` downstream yet; 2b is handed an ordinary,
  // fully consistent registry instead of one that only looks right through the
  // two maps it happens to read.
  const schemas: Record<string, ParsedSchema> = { ...current.schemas }
  for (const [name, type] of Object.entries(content_types)) schemas[name] = type
  for (const [name, type] of Object.entries(taxonomy_types)) schemas[name] = type

  return {
    ...current,
    schemas,
    content_types,
    taxonomy_types,
    // Original order and duplicates preserved (DUPLICATE_SCHEMA_NAME still
    // detectable), each entry swapped for its rebuilt counterpart.
    all_schemas: current.all_schemas.map((s) => schemas[s.name] ?? s),
  }
}
