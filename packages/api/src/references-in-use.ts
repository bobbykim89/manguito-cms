import { sql } from 'drizzle-orm'
import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { ownParagraphRowIds } from './relations.js'

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

// Every required single reference to `targetType` the owners declare, with its owner.
function requiredReferencesTo<O extends { fields: ParsedField[] }>(
  owners: O[],
  targetType: string
): Array<{ owner: O; f: ParsedField }> {
  return owners.flatMap((owner) =>
    owner.fields.filter((f) => isRequiredSingleReferenceTo(f, targetType)).map((f) => ({ owner, f }))
  )
}

// The required uses of an item, split in two. `others` lists the rows that
// make a delete refuse. The item's own paragraph rows (direct and nested) are
// not among them: they go with the item. `fromOwnParagraphs` says one of those
// rows refers back to the item, so the delete routes must remove the
// paragraphs before the row, which RESTRICT would refuse otherwise.
export type RequiredReferrers = { others: ReferrerCount[]; fromOwnParagraphs: boolean }

export async function findRequiredReferrers(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
  targetType: string,
  id: string
): Promise<RequiredReferrers> {
  const targetFields =
    registry.content_types[targetType]?.fields ?? registry.taxonomy_types[targetType]?.fields ?? []
  const itemOwners = [...Object.values(registry.content_types), ...Object.values(registry.taxonomy_types)]
  const itemFields = requiredReferencesTo(itemOwners, targetType)
  const paragraphFields = requiredReferencesTo(Object.values(registry.paragraph_types), targetType)

  // Paragraph rows are counted apart: the item's own rows against everyone
  // else's. The own ids are read once, and only when a paragraph field refers.
  const ownIds = paragraphFields.length > 0 ? await ownParagraphRowIds(db, registry, targetFields, id) : []

  // Each count is independent, so they run together. Promise.all keeps their
  // order, so the refusal lists its locations in schema order.
  const [itemCounts, paragraphCounts] = await Promise.all([
    Promise.all(
      itemFields.map(async ({ owner, f }) => {
        // A reference to its own type may point at the item itself. Postgres
        // deletes such a row under RESTRICT, so it is not a use to refuse.
        const notSelf = owner.name === targetType ? sql` AND id <> ${id}` : sql``
        const r = await db.execute(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(quoteIdent(owner.db.table_name))} WHERE ${sql.raw(quoteIdent(f.db_column!.column_name))} = ${id}${notSelf}`
        )
        return { owner, f, n: (r.rows[0] as { n: number }).n, own: 0 }
      })
    ),
    Promise.all(
      paragraphFields.map(async ({ owner, f }) => {
        const r = await db.execute(
          sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE id = ANY(${sql.param(ownIds)}::uuid[]))::int AS own FROM ${sql.raw(quoteIdent(owner.db.table_name))} WHERE ${sql.raw(quoteIdent(f.db_column!.column_name))} = ${id}`
        )
        const { n, own } = r.rows[0] as { n: number; own: number }
        return { owner, f, n, own }
      })
    ),
  ])

  const others: ReferrerCount[] = []
  for (const { owner, f, n, own } of [...itemCounts, ...paragraphCounts]) {
    if (n - own > 0) others.push({ type_label: owner.label, field_label: f.label, count: n - own })
  }
  return { others, fromOwnParagraphs: paragraphCounts.some((c) => c.own > 0) }
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
