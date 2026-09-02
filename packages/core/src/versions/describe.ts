import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField, FieldType } from '../registry/types.js'
import type { VersionSnapshot } from './types.js'
import { isColumnBacked } from '../registry/columns.js'

// ─── Output ───────────────────────────────────────────────────────────────────
//
// What changed between two versions of a schema, keyed by COLUMN rather than
// by name — which is what makes a rename legible as a rename instead of as a
// delete plus an add.
//
// A VALID model admits exactly these four kinds. Two more are unreachable: a
// column the older version exposes that is absent from the newer one is
// already VERSION_COLUMN_MISSING, and a column whose type changed is already
// FIELD_TYPE_CHANGED_WHILE_LIVE. So if the model loads, cutting is always
// safe, and this function never has to report a blocker.
//
// This classification covers only COLUMN-BACKED fields in content, taxonomy
// and paragraph types. A field with no storage column (`paragraph`,
// `programmatic`, or a many-to-many reference) and an enum type definition are
// both outside it — not because they are unimportant, but because neither is
// present in `VersionProjection` at all, so neither can differ between two
// versions' actual served contracts. `identical: true` therefore means "no
// column changed", not "nothing in the schema changed" — a real distinction a
// caller's messaging must preserve.

export type FieldChange =
  | { kind: 'added'; column: string; name: string; field_type: FieldType }
  | { kind: 'renamed'; column: string; from_name: string; to_name: string }
  | { kind: 'tombstoned'; column: string; name: string; fallback?: unknown }
  | { kind: 'restored'; column: string; name: string }

export type TypeChange = {
  type: string
  /** `added` when the newer schema defines a type the older did not. `dropped` is unreachable — it is VERSION_COLUMN_MISSING. */
  status: 'present' | 'added'
  /** Empty when the type is unchanged. */
  fields: FieldChange[]
}

export type SchemaChange = {
  /** The version compared against; `null` when nothing has been cut yet. */
  from: string | null
  /** The version the newer schema is (or would become). */
  to: string
  types: TypeChange[]
  /** True when no type or field changed. */
  identical: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Every content, taxonomy and paragraph type, as [name, fields] pairs. */
function typeEntries(registry: SchemaRegistry): Array<[string, ParsedField[]]> {
  return [
    ...Object.entries(registry.content_types),
    ...Object.entries(registry.taxonomy_types),
    ...Object.entries(registry.paragraph_types),
  ].map(([name, type]): [string, ParsedField[]] => [name, type.fields])
}

/** A type's column-backed fields keyed by column. Tombstones included — they hold a real column. */
function byColumn(fields: ParsedField[]): Map<string, ParsedField> {
  const out = new Map<string, ParsedField>()
  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    out.set(f.db_column!.column_name, f)
  }
  return out
}

// ─── describeSchemaChange ─────────────────────────────────────────────────────

/**
 * Classifies the difference between an older version and a newer one.
 *
 * Iterating the NEWER schema's types is complete: a type the older version
 * has and the newer one lacks cannot occur in a valid model, because the
 * completeness check would already have refused it.
 *
 * When a field is both renamed and tombstoned in one step, `tombstoned`
 * wins — it is the salient fact, and its `name` is the newer name, so no
 * information is lost. Same for renamed-and-restored.
 */
export function describeSchemaChange(input: {
  from: VersionSnapshot | null
  to: { version: string; registry: SchemaRegistry }
}): SchemaChange {
  const { from, to } = input
  const fromTypes = new Map(from === null ? [] : typeEntries(from.registry))
  const types: TypeChange[] = []

  for (const [typeName, toFields] of typeEntries(to.registry)) {
    const fromFields = fromTypes.get(typeName)
    const fromByColumn = byColumn(fromFields ?? [])
    const fields: FieldChange[] = []

    for (const [column, toField] of byColumn(toFields)) {
      const fromField = fromByColumn.get(column)

      if (fromField === undefined) {
        fields.push({ kind: 'added', column, name: toField.name, field_type: toField.field_type })
        continue
      }

      const wasTombstone = fromField.removed === true
      const isTombstone = toField.removed === true

      if (!wasTombstone && isTombstone) {
        fields.push({
          kind: 'tombstoned',
          column,
          name: toField.name,
          // Omitted entirely rather than set undefined, so an equality check
          // against the no-fallback case is clean.
          ...(toField.fallback !== undefined && { fallback: toField.fallback }),
        })
        continue
      }

      if (wasTombstone && !isTombstone) {
        fields.push({ kind: 'restored', column, name: toField.name })
        continue
      }

      if (fromField.name !== toField.name) {
        fields.push({ kind: 'renamed', column, from_name: fromField.name, to_name: toField.name })
      }
      // Otherwise unchanged — contributes no entry.
    }

    types.push({
      type: typeName,
      status: fromFields === undefined ? 'added' : 'present',
      fields,
    })
  }

  const identical = types.every((t) => t.status === 'present' && t.fields.length === 0)

  return { from: from?.version ?? null, to: to.version, types, identical }
}
