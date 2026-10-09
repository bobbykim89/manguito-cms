import type { ParsedField } from '@bobbykim/manguito-cms-core'
// The browser-safe subpath: core's main entry also carries Node-only code.
import { relationCardinality } from '@bobbykim/manguito-cms-core/cardinality'

// The value a new form starts each field at. A relation starts as null when it
// holds one item and [] when it holds a list (relationCardinality).
export function defaultForField(field: ParsedField): unknown {
  switch (field.field_type) {
    case 'text/plain':
    case 'text/rich':
      return ''
    case 'integer':
    case 'float':
      return null
    case 'boolean':
      return false
    case 'date':
      return null
    case 'image':
    case 'video':
    case 'file':
      return null
    case 'enum':
      return ''
    case 'reference':
    case 'paragraph':
      return relationCardinality(field) === 'many' ? [] : null
    default:
      return null
  }
}
