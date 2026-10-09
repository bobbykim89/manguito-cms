import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'

// Shape checks for relation values in an admin write, run before any database
// work. Every relation field PRESENT in the body must match its cardinality:
//   'one'  paragraph → a plain object, or null    'one'  reference → a string, or null
//   'many' paragraph → an array of plain objects  'many' reference → an array of strings
// Paragraph items are checked recursively; `path` prefixes nested names, so an
// error names e.g. "cards[0].card_link". Absent fields are not checked: an
// update leaves them untouched.
export type RelationInputError = { field: string; message: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function checkRelationInput(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
  path = '',
): RelationInputError[] {
  const errors: RelationInputError[] = []
  for (const field of fields) {
    if (!(field.name in body)) continue
    const cardinality = relationCardinality(field)
    if (cardinality === null) continue
    const value = body[field.name]
    const name = `${path}${field.name}`

    if (field.field_type === 'reference') {
      const ok =
        cardinality === 'one'
          ? value === null || typeof value === 'string'
          : Array.isArray(value) && value.every((v) => typeof v === 'string')
      if (!ok) {
        errors.push({
          field: name,
          message:
            cardinality === 'one'
              ? `${name} holds one item: send an id string or null.`
              : `${name} holds a list: send an array of id strings.`,
        })
      }
      continue
    }

    const items =
      cardinality === 'one'
        ? value === null
          ? []
          : isPlainObject(value)
            ? [value]
            : undefined
        : Array.isArray(value) && value.every(isPlainObject)
          ? value
          : undefined
    if (items === undefined) {
      errors.push({
        field: name,
        message:
          cardinality === 'one'
            ? `${name} holds one item: send an object or null.`
            : `${name} holds a list: send an array of objects.`,
      })
      continue
    }

    const comp = field.ui_component
    const pType = comp.component === 'paragraph-embed' ? registry.paragraph_types[comp.ref] : undefined
    if (!pType) continue
    items.forEach((item, i) => {
      const prefix = cardinality === 'one' ? `${name}.` : `${name}[${i}].`
      errors.push(...checkRelationInput(pType.fields, item, registry, prefix))
    })
  }
  return errors
}
