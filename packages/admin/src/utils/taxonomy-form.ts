import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { defaultForField } from './field-defaults'

// Whether the taxonomy read (GET /admin/api/taxonomy/{type}/:id) returns the
// field. It returns the item's own columns only: a paragraph field
// (db_column null) lives on the paragraph table and a many-to-many reference
// (db_column.junction) lives on its junction table, so neither comes back.
function isReadByTaxonomy(field: ParsedField): boolean {
  if (field.field_type === 'programmatic') return false
  return field.db_column !== null && !field.db_column.junction
}

// The taxonomy form's starting state, which is also what Save sends. A field
// the read does not return stays out of it: sending it as null would fail the
// api's relation shape check for a "many" field and erase a one-to-one
// paragraph, while an absent field is left untouched by the api.
// Programmatic fields are computed at read time and never submitted.
export function initialTaxonomyForm(
  fields: ParsedField[],
  source?: Record<string, unknown>
): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  for (const field of fields) {
    if (!isReadByTaxonomy(field)) continue
    form[field.name] = source?.[field.name] ?? defaultForField(field)
  }
  return form
}
