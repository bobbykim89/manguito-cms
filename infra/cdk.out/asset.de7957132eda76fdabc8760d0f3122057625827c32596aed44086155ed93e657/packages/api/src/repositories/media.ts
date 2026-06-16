import crypto from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  MediaRepository,
  MediaItem,
  CreateMediaInput,
  MediaFindManyOptions,
  PaginatedResult,
} from '@bobbykim/manguito-cms-core'

export function createMediaRepository(db: DrizzlePostgresInstance): MediaRepository {
  const TABLE = sql.raw('"media"')

  return {
    async findMany(opts: MediaFindManyOptions = {}): Promise<PaginatedResult<MediaItem>> {
      const { page = 1, per_page = 10, type, orphaned } = opts
      const offset = (page - 1) * per_page

      const conds = []
      if (type) conds.push(sql`type = ${type}`)
      if (orphaned) conds.push(sql`reference_count = 0`)

      const where =
        conds.length > 0 ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``

      const countResult = await db.execute(sql`SELECT COUNT(*) AS total FROM ${TABLE}${where}`)
      const total = Number(
        (countResult.rows[0] as Record<string, unknown>)?.['total'] ?? 0
      )

      const dataResult = await db.execute(
        sql`SELECT * FROM ${TABLE}${where} ORDER BY created_at DESC LIMIT ${per_page} OFFSET ${offset}`
      )

      const total_pages = Math.ceil(total / per_page)
      return {
        ok: true,
        data: dataResult.rows as MediaItem[],
        meta: {
          total,
          page,
          per_page,
          total_pages,
          has_next: page < total_pages,
          has_prev: page > 1,
        },
      }
    },

    async findOne(id: string): Promise<MediaItem | null> {
      const result = await db.execute(
        sql`SELECT * FROM ${TABLE} WHERE id = ${id} LIMIT 1`
      )
      if (result.rows.length === 0) return null
      return result.rows[0] as MediaItem
    },

    async create(data: CreateMediaInput): Promise<MediaItem> {
      const record: Record<string, unknown> = {
        ...data,
        id: crypto.randomUUID(),
        reference_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      }
      const entries = Object.entries(record).filter(([, v]) => v !== undefined)
      const colsSql = sql.join(entries.map(([k]) => sql.raw(`"${k}"`)), sql`, `)
      const valsSql = sql.join(entries.map(([, v]) => sql`${v}`), sql`, `)

      const result = await db.execute(
        sql`INSERT INTO ${TABLE} (${colsSql}) VALUES (${valsSql}) RETURNING *`
      )
      return result.rows[0] as MediaItem
    },

    async update(id: string, data: Partial<MediaItem>): Promise<MediaItem | null> {
      const record: Record<string, unknown> = { ...data, updated_at: new Date() }
      const entries = Object.entries(record).filter(
        ([k, v]) => k !== 'id' && v !== undefined
      )
      if (entries.length === 0) return this.findOne(id)

      const setClauses = sql.join(
        entries.map(([k, v]) => sql`${sql.raw(`"${k}"`)} = ${v}`),
        sql`, `
      )

      const result = await db.execute(
        sql`UPDATE ${TABLE} SET ${setClauses} WHERE id = ${id} RETURNING *`
      )
      if (result.rows.length === 0) return null
      return result.rows[0] as MediaItem
    },

    async delete(id: string): Promise<void> {
      await db.execute(sql`DELETE FROM ${TABLE} WHERE id = ${id}`)
    },

    async incrementReferenceCount(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      const inList = sql.join(ids.map((id) => sql`${id}`), sql`, `)
      await db.execute(
        sql`UPDATE ${TABLE} SET reference_count = reference_count + 1, updated_at = NOW() WHERE id IN (${inList})`
      )
    },

    async decrementReferenceCount(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      const inList = sql.join(ids.map((id) => sql`${id}`), sql`, `)
      await db.execute(
        sql`UPDATE ${TABLE} SET reference_count = GREATEST(reference_count - 1, 0), updated_at = NOW() WHERE id IN (${inList})`
      )
    },
  }
}
