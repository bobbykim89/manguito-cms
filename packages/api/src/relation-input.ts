import { sql } from 'drizzle-orm'
import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// Checks on relation values in an admin write, all run before any write.
// checkRelationInput (shape), checkRequiredInParagraphItems and
// findMissingReferences (one read per target table) each refuse an input that
// would otherwise make Postgres fail part-way through the write (#54).
//
// Shape: Every relation field PRESENT in the body must match its cardinality:
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

// The paragraph items present in a body, each with the paragraph type's fields
// and the path prefix its own fields are named under ("cards[1]." or
// "hero."). Assumes checkRelationInput passed, so values have the right shape.
function paragraphItemsIn(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
  path: string,
): Array<{ item: Record<string, unknown>; fields: ParsedField[]; prefix: string }> {
  const out: Array<{ item: Record<string, unknown>; fields: ParsedField[]; prefix: string }> = []
  for (const field of fields) {
    if (field.field_type !== 'paragraph' || !(field.name in body)) continue
    const comp = field.ui_component
    const pType = comp.component === 'paragraph-embed' ? registry.paragraph_types[comp.ref] : undefined
    if (!pType) continue
    const value = body[field.name]
    const name = `${path}${field.name}`
    if (relationCardinality(field) === 'one') {
      if (isPlainObject(value)) out.push({ item: value, fields: pType.fields, prefix: `${name}.` })
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (isPlainObject(item)) out.push({ item, fields: pType.fields, prefix: `${name}[${i}].` })
      })
    }
  }
  return out
}

// Same rule as the top-level required check in the admin routes.
function isMissing(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

// Required fields inside paragraph items. A required field that has its own
// column is NOT NULL in the paragraph table, so an item missing it makes
// Postgres refuse the insert, after persistParagraphField has already deleted
// the field's stored rows. Checked here, before any write, at every nesting
// level. Column-less fields (a nested paragraph, a many-to-many list) cannot
// make the insert fail and are not checked.
export function checkRequiredInParagraphItems(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
  path = '',
): RelationInputError[] {
  const errors: RelationInputError[] = []
  for (const { item, fields: itemFields, prefix } of paragraphItemsIn(fields, body, registry, path)) {
    for (const f of itemFields) {
      if (!f.required || f.removed === true || !f.db_column || f.db_column.junction) continue
      if (isMissing(item[f.name])) {
        errors.push({ field: `${prefix}${f.name}`, message: `${prefix}${f.name} is required.` })
      }
    }
    errors.push(...checkRequiredInParagraphItems(itemFields, item, registry, prefix))
  }
  return errors
}

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return `"${name}"`
}

type ReferenceUse = { table: string; id: string; field: string }

// Every reference id in the body, with the table it must exist in and the path
// that names it: single references ("owner"), list entries ("tags[1]"), and
// references inside paragraph items ("cards[0].card_tag").
function collectReferences(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
  path: string,
  out: ReferenceUse[],
): void {
  for (const f of fields) {
    if (f.field_type !== 'reference' || !(f.name in body) || !f.db_column) continue
    const table = f.db_column.junction ? f.db_column.junction.right_table : f.db_column.foreign_key?.table
    if (!table) continue
    const value = body[f.name]
    const name = `${path}${f.name}`
    if (typeof value === 'string') {
      out.push({ table, id: value, field: name })
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'string') out.push({ table, id: v, field: `${name}[${i}]` })
      })
    }
  }
  for (const { item, fields: itemFields, prefix } of paragraphItemsIn(fields, body, registry, path)) {
    collectReferences(itemFields, item, registry, prefix, out)
  }
}

// Reference ids that point at no row. A missing target makes Postgres refuse
// the insert on its foreign key (23503) part-way through a write that has
// already deleted the field's old links or paragraph rows. One query per target
// table. Unpublished targets exist and pass. Assumes checkRelationInput passed.
export async function findMissingReferences(
  db: DrizzlePostgresInstance,
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
): Promise<RelationInputError[]> {
  const uses: ReferenceUse[] = []
  collectReferences(fields, body, registry, '', uses)
  if (uses.length === 0) return []

  const found = new Map<string, Set<string>>()
  for (const table of new Set(uses.map((u) => u.table))) {
    const ids = [...new Set(uses.filter((u) => u.table === table).map((u) => u.id.toLowerCase()))]
    const result = await db.execute(
      sql`SELECT id FROM ${sql.raw(quoteIdent(table))} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
    )
    found.set(table, new Set((result.rows as Array<{ id: string }>).map((r) => String(r.id).toLowerCase())))
  }

  return uses
    .filter((u) => !found.get(u.table)!.has(u.id.toLowerCase()))
    .map((u) => ({ field: u.field, message: `${u.field} refers to an item that does not exist.` }))
}
