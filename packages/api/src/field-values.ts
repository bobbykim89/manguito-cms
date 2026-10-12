import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { isPlainObject, paragraphItemsIn, paragraphTypeOf, type RelationInputError } from './relation-input.js'

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
// An ISO date, optionally with a time and a zone. Its parts are checked as a
// real calendar date below: Date.parse accepts 2026-02-30, Postgres does not.
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
// How Postgres returns a numeric column: a decimal string, such as "9.9900".
const DECIMAL_STRING = /^-?\d+(?:\.\d+)?$/

// Field types whose column cannot hold '' (a timestamp, a number, an enum).
const EMPTY_MEANS_NULL = new Set(['date', 'integer', 'float', 'enum'])

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
    const pType = paragraphTypeOf(f, registry)
    if (!pType) continue
    if (isPlainObject(value)) out[f.name] = emptyValuesToNull(pType.fields, value, registry)
    else if (Array.isArray(value)) {
      out[f.name] = value.map((item) => (isPlainObject(item) ? emptyValuesToNull(pType.fields, item, registry) : item))
    }
  }
  return out
}

// A declared pattern, compiled once. An invalid one (the parser does not
// check that it compiles) is skipped, as it was before the API checked it.
const compiled = new Map<string, RegExp | null>()
function patternOf(source: string): RegExp | null {
  if (!compiled.has(source)) {
    let re: RegExp | null
    try {
      re = new RegExp(source)
    } catch {
      re = null
    }
    compiled.set(source, re)
  }
  return compiled.get(source) ?? null
}

// Whether an ISO date string names a real moment Postgres can store: a month
// and day that exist (no 2026-02-30), a year from 1, hours, minutes and
// seconds in range.
function isRealDate(value: string): boolean {
  const m = ISO_TIMESTAMP.exec(value)
  if (!m) return false
  const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1).map((part) => (part === undefined ? undefined : Number(part)))
  if (y === undefined || mo === undefined || d === undefined || y < 1) return false
  const date = new Date(Date.UTC(y, mo - 1, d))
  date.setUTCFullYear(y)
  return (
    date.getUTCMonth() === mo - 1 && date.getUTCDate() === d &&
    h <= 23 && mi <= 59 && sec <= 59
  )
}

// The problem with one field's value, or null when it is fine.
function valueError(f: ParsedField, value: unknown, name: string): string | null {
  const v = f.validation

  // A list belongs to a relation field: only its length is checked here.
  // An array sent for any other field falls through and fails its type check.
  if (Array.isArray(value) && (f.field_type === 'paragraph' || f.field_type === 'reference')) {
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
      if (value.includes('\u0000')) return `${name} contains a character that cannot be stored (U+0000).`
      const limit = v.limit ?? VARCHAR_DEFAULT_LIMIT
      // Postgres counts characters, not UTF-16 units.
      if ([...value].length > limit) return `${name} can be at most ${limit} characters.`
      // An empty optional field is not tested against its pattern, as in the
      // admin form, which sends '' for a text field left blank.
      const pattern = v.pattern === undefined ? null : patternOf(v.pattern)
      if (value !== '' && pattern && !pattern.test(value)) return `${name} is not in the correct format.`
      return null
    }
    case 'text/rich':
      if (typeof value !== 'string') return `${name} must be text.`
      return value.includes('\u0000') ? `${name} contains a character that cannot be stored (U+0000).` : null
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${name} must be a whole number.`
      if (value < INTEGER_MIN || value > INTEGER_MAX) {
        return `${name} must be between ${INTEGER_MIN} and ${INTEGER_MAX}.`
      }
      return rangeError(name, value, v.min, v.max)
    case 'float': {
      // A number, or the decimal string a read returned for it (the admin
      // form sends a stored value back as it read it).
      const n = typeof value === 'number' ? value : typeof value === 'string' && DECIMAL_STRING.test(value) ? Number(value) : NaN
      if (!Number.isFinite(n)) return `${name} must be a number.`
      if (roundedSize(typeof value === 'string' ? value : String(n)) >= DECIMAL_LIMIT) {
        return `${name} must be less than ${DECIMAL_LIMIT} in size.`
      }
      return rangeError(name, n, v.min, v.max)
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${name} must be true or false.`
    case 'date':
      return typeof value === 'string' && isRealDate(value)
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

// The size of a decimal as Postgres stores it in decimal(10, 4): rounded half
// away from zero to four places, from the text it is sent as. node-postgres
// sends 999999.99995 as that text, which rounds up past the column, although
// the binary double is just below it.
function roundedSize(text: string): number {
  if (text.includes('e')) return Math.abs(Number(text)) // tiny or huge: no rounding question
  const [int = '0', frac = ''] = text.replace('-', '').split('.')
  const kept = Number(`${int}.${frac.slice(0, 4) || '0'}`)
  return frac.length > 4 && frac.charAt(4) >= '5' ? kept + 0.0001 : kept
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
