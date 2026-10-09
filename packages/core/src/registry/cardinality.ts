import type { ParsedField } from './types'

// Whether a relation field holds one item or a list. Every layer that shapes,
// validates or renders a relation value asks this function, so they cannot
// disagree again (docs/adr/core/0008-one-rule-for-relation-cardinality.md).
export type Cardinality = 'one' | 'many'

export function relationCardinality(field: ParsedField): Cardinality | null {
  const c = field.ui_component
  if (field.field_type === 'paragraph' && c.component === 'paragraph-embed') {
    return c.rel === 'one-to-one' ? 'one' : 'many'
  }
  if (field.field_type === 'reference' && c.component === 'typeahead-select') {
    // A one-to-many reference is stored as one FK column on the owning table,
    // so it holds one item. Deprecated: see findSchemaDeprecations.
    return c.rel === 'many-to-many' ? 'many' : 'one'
  }
  return null
}
