import type { SchemaRegistry } from '../parser/validate'
import type { ParsedField } from './types'

// Schema constructs that still work but that authors should move off. Computed
// from the finished registry rather than inside the parser: ParseResult has no
// warning channel, and adding one would change a type every consumer depends on.
export type SchemaDeprecation = {
  source_file: string
  type_name: string
  field_name: string
  message: string
}

export function findSchemaDeprecations(registry: SchemaRegistry): SchemaDeprecation[] {
  const out: SchemaDeprecation[] = []
  const owners = [
    ...Object.values(registry.content_types),
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.paragraph_types),
  ]
  for (const owner of owners) {
    for (const field of owner.fields as ParsedField[]) {
      if (field.field_type !== 'reference') continue
      const c = field.ui_component
      if (c.component !== 'typeahead-select' || c.rel !== 'one-to-many') continue
      out.push({
        source_file: owner.source_file,
        type_name: owner.name,
        field_name: field.name,
        message: `${owner.name}.${field.name} uses "one-to-many", which is deprecated for references. It holds a single item, the same as "one-to-one". Use "one-to-one" for a single item, or "many-to-many" for a list.`,
      })
    }
  }
  return out
}
