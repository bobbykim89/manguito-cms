import crypto from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { ParsedField, ParsedParagraphType, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { MediaDelta } from './media-references.js'

// ─── Relation persistence ─────────────────────────────────────────────────────
//
// Owns paragraph/junction/reference/media relation table SQL — both the write
// side (persist/delete below) and the read side (descriptors + resolvers further
// down). Each persist/delete returns the MediaDelta of media ids it gained and
// lost (see media-references.ts), which the caller merges and reconciles once.
// The repository's resolveRows() drives the read resolvers.

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

// ─── Relation descriptors and resolution (read side) ──────────────────────────
//
// Relation read resolution. These were lifted out of the repository so that all
// paragraph/junction/reference/media table SQL lives in one module alongside the
// write persistence above. The repository's resolveRows() calls into here.

export type ParagraphRelationDef = {
  type: 'paragraph'
  table: string
}

export type ReferenceRelationDef = {
  type: 'reference'
  table: string
  fk_column: string
}

export type JunctionRelationDef = {
  type: 'junction'
  table: string
  junction_table: string
  left_column: string
  right_column: string
  // Only ordered junctions have an "order" column (db codegen emits it only when
  // order_column is true) — the resolver must not ORDER BY it otherwise.
  order_column: boolean
}

export type MediaRelationDef = {
  type: 'media'
  fk_column: string
}

export type RelationDef =
  | ParagraphRelationDef
  | ReferenceRelationDef
  | JunctionRelationDef
  | MediaRelationDef

// Derives a content type's relations map from its parsed fields, so paragraph/
// reference/media fields are actually resolved instead of silently dropped.
// Junction and foreign_key info is already on each field's db_column; paragraph
// fields store their target table on the paragraph type, hence the registry.
export function buildRelationsMap(
  fields: ParsedField[],
  registry: SchemaRegistry
): Record<string, RelationDef> {
  const relations: Record<string, RelationDef> = {}

  for (const field of fields) {
    if (field.field_type === 'image' || field.field_type === 'video' || field.field_type === 'file') {
      if (!field.db_column) continue
      relations[field.name] = { type: 'media', fk_column: field.db_column.column_name }
    } else if (field.field_type === 'paragraph') {
      const ref = (field.ui_component as { ref?: string }).ref
      const pType = ref ? registry.paragraph_types[ref] : undefined
      if (!pType) continue
      relations[field.name] = { type: 'paragraph', table: pType.db.table_name }
    } else if (field.field_type === 'reference') {
      if (!field.db_column) continue
      if (field.db_column.junction) {
        const j = field.db_column.junction
        relations[field.name] = {
          type: 'junction',
          table: j.right_table,
          junction_table: j.table_name,
          left_column: j.left_column,
          right_column: j.right_column,
          order_column: j.order_column,
        }
      } else if (field.db_column.foreign_key) {
        relations[field.name] = {
          type: 'reference',
          table: field.db_column.foreign_key.table,
          fk_column: field.db_column.column_name,
        }
      }
    }
  }

  return relations
}

function groupBy<T extends Record<string, unknown>>(
  items: T[],
  key: string
): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) {
    const k = String(item[key])
    if (!result[k]) result[k] = []
    result[k]!.push(item)
  }
  return result
}

// Fully resolves a relation field on a batch of rows: paragraph → ordered rows,
// reference → the target row, junction → target rows, media → the media row.
// The cache (keyed table:id) dedupes target lookups within a request.
export async function resolveRelationField(
  db: DrizzlePostgresInstance,
  rows: Record<string, unknown>[],
  fieldName: string,
  rel: RelationDef,
  cache: Map<string, unknown>
): Promise<void> {
  if (rows.length === 0) return

  if (rel.type === 'paragraph') {
    const parentIds = rows.map((r) => r['id'] as string)
    const inList = sql.join(parentIds.map((id) => sql`${id}`), sql`, `)
    const result = await db.execute(
      sql`SELECT * FROM ${sql.raw(quoteIdent(rel.table))} WHERE parent_id IN (${inList}) ORDER BY "order" ASC`
    )
    const byParent = groupBy(result.rows as Record<string, unknown>[], 'parent_id')
    for (const row of rows) {
      row[fieldName] = byParent[row['id'] as string] ?? []
    }
  } else if (rel.type === 'reference') {
    const fkValues = rows.map((r) => r[rel.fk_column] as string).filter(Boolean)
    if (fkValues.length === 0) {
      for (const row of rows) row[fieldName] = null
      return
    }
    const unique = [...new Set(fkValues)]
    const uncached = unique.filter((id) => !cache.has(`${rel.table}:${id}`))
    if (uncached.length > 0) {
      const inList = sql.join(uncached.map((id) => sql`${id}`), sql`, `)
      const result = await db.execute(
        sql`SELECT * FROM ${sql.raw(quoteIdent(rel.table))} WHERE id IN (${inList})`
      )
      for (const item of result.rows as Record<string, unknown>[]) {
        cache.set(`${rel.table}:${item['id']}`, item)
      }
    }
    for (const row of rows) {
      const fkVal = row[rel.fk_column] as string
      row[fieldName] = fkVal ? (cache.get(`${rel.table}:${fkVal}`) ?? null) : null
    }
  } else if (rel.type === 'junction') {
    const parentIds = rows.map((r) => r['id'] as string)
    const inList = sql.join(parentIds.map((id) => sql`${id}`), sql`, `)
    const orderBy = rel.order_column ? sql` ORDER BY "order" ASC` : sql``
    const junctionResult = await db.execute(
      sql`SELECT * FROM ${sql.raw(quoteIdent(rel.junction_table))} WHERE ${sql.raw(quoteIdent(rel.left_column))} IN (${inList})${orderBy}`
    )
    const jRows = junctionResult.rows as Record<string, unknown>[]
    const rightIds = [...new Set(jRows.map((r) => r[rel.right_column] as string))]
    const uncached = rightIds.filter((id) => !cache.has(`${rel.table}:${id}`))
    if (uncached.length > 0) {
      const rightInList = sql.join(uncached.map((id) => sql`${id}`), sql`, `)
      const entitiesResult = await db.execute(
        sql`SELECT * FROM ${sql.raw(quoteIdent(rel.table))} WHERE id IN (${rightInList})`
      )
      for (const item of entitiesResult.rows as Record<string, unknown>[]) {
        cache.set(`${rel.table}:${item['id']}`, item)
      }
    }
    const byLeft = groupBy(jRows, rel.left_column)
    for (const row of rows) {
      const jEntries = byLeft[row['id'] as string] ?? []
      row[fieldName] = jEntries
        .map((jr) => cache.get(`${rel.table}:${jr[rel.right_column] as string}`))
        .filter(Boolean)
    }
  } else if (rel.type === 'media') {
    const fkValues = rows.map((r) => r[rel.fk_column] as string).filter(Boolean)
    if (fkValues.length === 0) {
      for (const row of rows) row[fieldName] = null
      return
    }
    const unique = [...new Set(fkValues)]
    const uncached = unique.filter((id) => !cache.has(`media:${id}`))
    if (uncached.length > 0) {
      const inList = sql.join(uncached.map((id) => sql`${id}`), sql`, `)
      const result = await db.execute(sql`SELECT * FROM "media" WHERE id IN (${inList})`)
      for (const item of result.rows as Record<string, unknown>[]) {
        cache.set(`media:${item['id']}`, item)
      }
    }
    for (const row of rows) {
      const fkVal = row[rel.fk_column] as string
      row[fieldName] = fkVal ? (cache.get(`media:${fkVal}`) ?? null) : null
    }
  }
}

// Populates paragraph/junction fields with bare ID arrays when they are not
// explicitly included — they have no column on the owning table, so without this
// they'd be silently absent. Reference fields already carry their bare ID as a
// real column from `SELECT *`, so they need no extra query.
export async function resolveRelationBareIds(
  db: DrizzlePostgresInstance,
  rows: Record<string, unknown>[],
  fieldName: string,
  rel: RelationDef
): Promise<void> {
  if (rows.length === 0) return

  if (rel.type === 'paragraph') {
    const parentIds = rows.map((r) => r['id'] as string)
    const inList = sql.join(parentIds.map((id) => sql`${id}`), sql`, `)
    const result = await db.execute(
      sql`SELECT id, parent_id FROM ${sql.raw(quoteIdent(rel.table))} WHERE parent_id IN (${inList}) ORDER BY "order" ASC`
    )
    const byParent = groupBy(result.rows as Record<string, unknown>[], 'parent_id')
    for (const row of rows) {
      row[fieldName] = (byParent[row['id'] as string] ?? []).map((r) => r['id'])
    }
  } else if (rel.type === 'junction') {
    const parentIds = rows.map((r) => r['id'] as string)
    const inList = sql.join(parentIds.map((id) => sql`${id}`), sql`, `)
    const result = await db.execute(
      sql`SELECT ${sql.raw(quoteIdent(rel.left_column))} AS left_id, ${sql.raw(quoteIdent(rel.right_column))} AS right_id FROM ${sql.raw(quoteIdent(rel.junction_table))} WHERE ${sql.raw(quoteIdent(rel.left_column))} IN (${inList})`
    )
    const byLeft = groupBy(result.rows as Record<string, unknown>[], 'left_id')
    for (const row of rows) {
      row[fieldName] = (byLeft[row['id'] as string] ?? []).map((r) => r['right_id'])
    }
  }
}
