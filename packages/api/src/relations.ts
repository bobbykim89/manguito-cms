import crypto from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { ParsedParagraphType } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { MediaDelta } from './media-references.js'

// ─── Relation persistence ─────────────────────────────────────────────────────
//
// Owns the write side of paragraph and junction relations — the table SQL that
// the admin write handlers used to hand-roll. Each persist/delete returns the
// MediaDelta of media ids it gained and lost (see media-references.ts), which the
// caller merges and reconciles once. The read-side resolvers still live in the
// repository for now; folding them in here is deferred until the integration DB
// can verify the SQL.

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return `"${name}"`
}

// Paragraph rows live on a child table with their own image/video/file columns
// (e.g. a "photo card" block embeds an image) — these need the same reference-count
// bookkeeping as top-level content fields, one level down.
function paragraphMediaFieldNames(pType: ParsedParagraphType): Set<string> {
  return new Set(
    pType.fields
      .filter((f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file')
      .map((f) => f.name)
  )
}

async function fetchParagraphMediaIds(
  db: DrizzlePostgresInstance,
  pType: ParsedParagraphType,
  itemId: string,
  fieldName: string
): Promise<string[]> {
  const mediaColumns = pType.fields
    .filter((f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file')
    .map((f) => f.db_column!.column_name)
  if (mediaColumns.length === 0) return []

  const tbl = sql.raw(quoteIdent(pType.db.table_name))
  const cols = sql.join(mediaColumns.map((c) => sql.raw(quoteIdent(c))), sql`, `)
  const result = await db.execute(
    sql`SELECT ${cols} FROM ${tbl} WHERE parent_id = ${itemId} AND parent_field = ${fieldName}`
  )

  const ids: string[] = []
  for (const row of result.rows as Record<string, unknown>[]) {
    for (const col of mediaColumns) {
      const v = row[col]
      if (typeof v === 'string' && v !== '') ids.push(v)
    }
  }
  return ids
}

// Replaces every paragraph row for one field of one parent (delete + reinsert),
// returning the media ids removed (old rows) and added (new rows).
export async function persistParagraphField(
  db: DrizzlePostgresInstance,
  itemId: string,
  parentType: string,
  fieldName: string,
  pType: ParsedParagraphType,
  items: unknown[]
): Promise<MediaDelta> {
  const removed = await fetchParagraphMediaIds(db, pType, itemId, fieldName)

  const tbl = sql.raw(quoteIdent(pType.db.table_name))
  await db.execute(sql`DELETE FROM ${tbl} WHERE parent_id = ${itemId} AND parent_field = ${fieldName}`)

  const mediaFieldNames = paragraphMediaFieldNames(pType)
  const added: string[] = []

  for (let i = 0; i < items.length; i++) {
    const pItem = items[i] as Record<string, unknown>
    const data: Record<string, unknown> = {
      id: crypto.randomUUID(),
      parent_id: itemId,
      parent_type: parentType,
      parent_field: fieldName,
      order: i,
      created_at: new Date(),
      updated_at: new Date(),
    }
    for (const pf of pType.fields) {
      if (!pf.db_column || pf.db_column.junction) continue
      data[pf.db_column.column_name] = pItem[pf.name] ?? null
    }
    const cols = sql.join(Object.keys(data).map((k) => sql.raw(quoteIdent(k))), sql`, `)
    const vals = sql.join(Object.values(data).map((v) => sql`${v}`), sql`, `)
    await db.execute(sql`INSERT INTO ${tbl} (${cols}) VALUES (${vals})`)

    for (const name of mediaFieldNames) {
      const val = pItem[name]
      if (typeof val === 'string' && val !== '') added.push(val)
    }
  }

  return { added, removed }
}

// Deletes all paragraph rows for one field of one parent (used when the parent is
// being deleted — paragraph rows have no FK/cascade back to their parent, so they'd
// leak otherwise). Returns the media those rows referenced, all removed.
export async function deleteParagraphField(
  db: DrizzlePostgresInstance,
  itemId: string,
  fieldName: string,
  pType: ParsedParagraphType
): Promise<MediaDelta> {
  const removed = await fetchParagraphMediaIds(db, pType, itemId, fieldName)
  const tbl = sql.raw(quoteIdent(pType.db.table_name))
  await db.execute(sql`DELETE FROM ${tbl} WHERE parent_id = ${itemId} AND parent_field = ${fieldName}`)
  return { added: [], removed }
}

// Replaces every junction row for one many-to-many field of one parent.
export async function persistJunctionField(
  db: DrizzlePostgresInstance,
  itemId: string,
  junction: { table_name: string; left_column: string; right_column: string },
  relatedIds: string[]
): Promise<void> {
  const tbl = sql.raw(quoteIdent(junction.table_name))
  const left = sql.raw(quoteIdent(junction.left_column))
  const right = sql.raw(quoteIdent(junction.right_column))
  await db.execute(sql`DELETE FROM ${tbl} WHERE ${left} = ${itemId}`)
  for (const rid of relatedIds) {
    await db.execute(sql`INSERT INTO ${tbl} (${left}, ${right}) VALUES (${itemId}, ${rid})`)
  }
}
