import type { DbColumn } from './types.js'

/**
 * Whether a field has a storage column of its own.
 *
 * Two kinds do not: a paragraph field has no column at all (the association
 * lives on the paragraph table via parent_id/parent_type/parent_field), and a
 * many-to-many reference has none either (the junction table owns the
 * association). For both, the field's name already IS its identity — there is
 * no column to declare, project, or retain.
 *
 * The parameter is structural rather than `ParsedField` so the parser can call
 * it on a `BuiltField` before the `ParsedField` around it exists.
 */
export function isColumnBacked(field: { db_column: DbColumn | null }): boolean {
  const col = field.db_column
  return col !== null && col.column_name !== '' && !col.junction
}
