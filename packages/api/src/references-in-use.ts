import { sql } from 'drizzle-orm'
import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// Which required references still point at an item about to be deleted. A
// required single-column reference RESTRICTs deletes of its target
// (docs/adr/core/0008), so the delete routes ask first and answer 409 with
// these locations. Optional references are left out: their FK sets null, so
// deleting the target simply clears them.
export type ReferrerCount = { type_label: string; field_label: string; count: number }

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return `"${name}"`
}

function isRequiredSingleReferenceTo(f: ParsedField, targetType: string): boolean {
  return (
    f.field_type === 'reference' &&
    f.required &&
    relationCardinality(f) === 'one' &&
    f.db_column?.foreign_key !== undefined &&
    f.ui_component.component === 'typeahead-select' &&
    f.ui_component.ref === targetType
  )
}

export async function findRequiredReferrers(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
  targetType: string,
  id: string
): Promise<ReferrerCount[]> {
  const owners = [
    ...Object.values(registry.content_types),
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.paragraph_types),
  ]
  const out: ReferrerCount[] = []
  for (const owner of owners) {
    for (const f of owner.fields) {
      if (!isRequiredSingleReferenceTo(f, targetType)) continue
      const r = await db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(quoteIdent(owner.db.table_name))} WHERE ${sql.raw(quoteIdent(f.db_column!.column_name))} = ${id}`
      )
      const n = (r.rows[0] as { n: number }).n
      if (n > 0) out.push({ type_label: owner.label, field_label: f.label, count: n })
    }
  }
  return out
}

export function inUseMessage(referrers: ReferrerCount[]): string {
  const total = referrers.reduce((sum, r) => sum + r.count, 0)
  const where = referrers.map((r) => `${r.count} in ${r.type_label} (${r.field_label})`).join(', ')
  return `This item is still used by ${total} item${total === 1 ? '' : 's'}: ${where}. Remove it from those first.`
}

// The backstop's message: a use added between the check and the delete, which
// the RESTRICT constraint refused. The pre-check's labels are not available.
export const IN_USE_RACE_MESSAGE = 'This item is still in use. Remove it from the items that use it first.'

// Postgres reports a foreign-key violation as SQLSTATE 23503. Drizzle wraps the
// driver error, so the code sits on the error itself or a few causes down.
export function isForeignKeyViolation(err: unknown): boolean {
  let e: unknown = err
  for (let depth = 0; depth < 3 && typeof e === 'object' && e !== null; depth++) {
    if ((e as { code?: unknown }).code === '23503') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
