import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { paragraphItemsIn, type RelationInputError } from './relation-input.js'

// Values in an admin write, checked before any write (#57). Postgres refuses
// a value of the wrong type, text longer than its column, a number its column
// cannot hold, or an enum value outside its set, but only once earlier
// statements of the write have run, after a paragraph field's old rows are
// already deleted. The schema's declared rules (pattern, min and max, max
// items) are checked here too, for every client, as the admin form does in the
// browser. Covers top-level fields and paragraph items at every level; a field
// absent from the body is not checked. Reference and media ids are checked by
// relation-input.ts.

// Column bounds, as db codegen declares them.
const VARCHAR_DEFAULT_LIMIT = 255
const INTEGER_MIN = -2147483648
const INTEGER_MAX = 2147483647
// decimal(10, 4): at most six digits before the point.
const DECIMAL_LIMIT = 1_000_000
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

// Field types whose column cannot hold '' (a timestamp, a number, an enum).
const EMPTY_MEANS_NULL = new Set(['date', 'integer', 'float', 'enum'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// '' is how a form says "no value" for a date, number or enum field; their
// columns cannot store it, so it is stored as null. Applied to top-level
// fields and paragraph items before the checks below. Returns a new body.
export function emptyValuesToNull(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const f of fields) {
    if (!(f.name in out)) continue
    const value = out[f.name]
    if (value === '' && EMPTY_MEANS_NULL.has(f.field_type)) {
      out[f.name] = null
      continue
    }
    if (f.field_type !== 'paragraph') continue
    const comp = f.ui_component
    const pType = comp.component === 'paragraph-embed' ? registry.paragraph_types[comp.ref] : undefined
    if (!pType) continue
    if (isPlainObject(value)) out[f.name] = emptyValuesToNull(pType.fields, value, registry)
    else if (Array.isArray(value)) {
      out[f.name] = value.map((item) => (isPlainObject(item) ? emptyValuesToNull(pType.fields, item, registry) : item))
    }
  }
  return out
}

// The problem with one field's value, or null when it is fine.
function valueError(f: ParsedField, value: unknown, name: string): string | null {
  const v = f.validation

  if (Array.isArray(value)) {
    if (v.max_items !== undefined && value.length > v.max_items) {
      return `${name} can hold at most ${v.max_items} items.`
    }
    return null
  }

  // Only a stored scalar from here: a column of its own, and not a reference
  // or media id (relation-input.ts checks those).
  const col = f.db_column
  if (!col || col.junction || col.column_type === 'uuid') return null
  if (value === null || value === undefined) {
    if (col.nullable) return null
    // A NOT NULL column: a required field, or a boolean (which defaults false).
    return f.required ? `${name} is required.` : `${name} cannot be empty.`
  }

  switch (f.field_type) {
    case 'text/plain': {
      if (typeof value !== 'string') return `${name} must be text.`
      const limit = v.limit ?? VARCHAR_DEFAULT_LIMIT
      // Postgres counts characters, not UTF-16 units.
      if ([...value].length > limit) return `${name} can be at most ${limit} characters.`
      if (v.pattern !== undefined && !new RegExp(v.pattern).test(value)) return `${name} is not in the correct format.`
      return null
    }
    case 'text/rich':
      return typeof value === 'string' ? null : `${name} must be text.`
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${name} must be a whole number.`
      if (value < INTEGER_MIN || value > INTEGER_MAX) return `${name} is too large.`
      return rangeError(name, value, v.min, v.max)
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a number.`
      if (Math.abs(value) >= DECIMAL_LIMIT) return `${name} must be less than ${DECIMAL_LIMIT} in size.`
      return rangeError(name, value, v.min, v.max)
    case 'boolean':
      return typeof value === 'boolean' ? null : `${name} must be true or false.`
    case 'date':
      return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : `${name} must be a date, such as 2026-10-11 or 2026-10-11T09:30:00Z.`
    case 'enum': {
      const allowed = v.allowed_values ?? []
      return typeof value === 'string' && allowed.includes(value)
        ? null
        : `${name} must be one of: ${allowed.join(', ')}.`
    }
    default:
      return null
  }
}

function rangeError(name: string, value: number, min?: number, max?: number): string | null {
  if (min !== undefined && value < min) return `${name} must be at least ${min}.`
  if (max !== undefined && value > max) return `${name} must be at most ${max}.`
  return null
}

// Every value in the body that would fail its column or its declared rules,
// named by path ("price", "cards[0].price", "hero.caption"). Assumes
// checkRelationInput passed, so paragraph values have the right shape.
export function checkFieldValues(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
  path = '',
): RelationInputError[] {
  const errors: RelationInputError[] = []
  for (const f of fields) {
    if (!(f.name in body) || f.removed === true) continue
    const name = `${path}${f.name}`
    const message = valueError(f, body[f.name], name)
    if (message) errors.push({ field: name, message })
  }
  for (const { item, fields: itemFields, prefix } of paragraphItemsIn(fields, body, registry, path)) {
    errors.push(...checkFieldValues(itemFields, item, registry, prefix))
  }
  return errors
}
