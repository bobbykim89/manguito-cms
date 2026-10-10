import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { defaultForField } from './field-defaults'

// The taxonomy form's starting state, which is also what Save sends. Every
// field the taxonomy edit read returns is included, relation fields too: the
// read loads paragraph fields and many-to-many link ids (#55). A field with no
// stored value starts at its empty default (null for a 'one' relation, [] for
// a 'many' one). Programmatic fields are computed at read time and never
// submitted, so they stay out.
export function initialTaxonomyForm(
  fields: ParsedField[],
  source?: Record<string, unknown>
): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.field_type === 'programmatic') continue
    form[field.name] = source?.[field.name] ?? defaultForField(field)
  }
  return form
}
