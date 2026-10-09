import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'

// Shape checks for relation values in an admin write, run before any database
// work. Every relation field PRESENT in the body must match its cardinality:
//   'one'  paragraph → a plain object, or null    'one'  reference → a UUID string, or null
//   'many' paragraph → an array of plain objects  'many' reference → an array of UUID strings
// Paragraph items are checked recursively; `path` prefixes nested names, so an
// error names e.g. "cards[0].card_link". Absent fields are not checked: an
// update leaves them untouched. Reference ids must be UUIDs: Postgres refuses
// anything else (22P02) only after earlier statements of the write have run.
export type RelationInputError = { field: string; message: string }

// The canonical 8-4-4-4-12 hex form, which Postgres's uuid type accepts.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

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
          ? value === null || isUuid(value)
          : Array.isArray(value) && value.every(isUuid)
      if (!ok) {
        errors.push({
          field: name,
          message:
            cardinality === 'one'
              ? `${name} holds one item: send a UUID string or null.`
              : `${name} holds a list: send an array of UUID strings.`,
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
