import crypto from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  ContentRepository,
  PaginatedResult,
  FindManyOptions,
  FindAllOptions,
  CreateInput,
  UpdateInput,
  FilterOperator,
  FilterValue,
} from '@bobbykim/manguito-cms-core'
import {
  resolveRelationField,
  resolveRelationBareIds,
  type RelationDef,
} from '../relations.js'

// ─── Repository options ───────────────────────────────────────────────────────

export type ContentRepositoryOptions = {
  relations?: Record<string, RelationDef>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SORTABLE_FIELDS = new Set(['title', 'created_at', 'updated_at'])

function codeError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code: string }).code = code
  return err
}

// Only allow table/column identifiers that are developer-controlled.
// Table names can include hyphens (e.g. content--blog_post).
function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`)
  }
  return `"${name.replace(/"/g, '""')}"`
}

// User-supplied filter field names — strict, no hyphens.
function quoteField(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw codeError('INVALID_FILTER_FIELD', `Invalid filter field name: ${name}`)
  }
  return `"${name}"`
}

function buildConditions(
  published_only: boolean | undefined,
  filters: Record<string, FilterValue> | undefined,
  search: { term: string; columns: string[] } | undefined
): SQL[] {
  const conds: SQL[] = []

  if (published_only) {
    conds.push(sql`published = true`)
  }

  if (search && search.term.trim() !== '' && search.columns.length > 0) {
    const pattern = `%${search.term.trim()}%`
    const orConds = search.columns.map((col) => sql`${sql.raw(quoteField(col))} ILIKE ${pattern}`)
    conds.push(sql`(${sql.join(orConds, sql` OR `)})`)
  }

  if (filters) {
    for (const [field, value] of Object.entries(filters)) {
      const col = sql.raw(quoteField(field))

      if (Array.isArray(value)) {
        if (value.length === 0) continue
        const inList = sql.join(
          value.map((v) => sql`${v}`),
          sql`, `
        )
        conds.push(sql`${col} IN (${inList})`)
      } else if (
        typeof value === 'object' &&
        value !== null
      ) {
        const op = value as FilterOperator
        if (op.gt !== undefined) conds.push(sql`${col} > ${op.gt}`)
        if (op.gte !== undefined) conds.push(sql`${col} >= ${op.gte}`)
        if (op.lt !== undefined) conds.push(sql`${col} < ${op.lt}`)
        if (op.lte !== undefined) conds.push(sql`${col} <= ${op.lte}`)
      } else {
        conds.push(sql`${col} = ${value}`)
      }
    }
  }

  return conds
}

function whereFragment(conds: SQL[]): SQL {
  return conds.length > 0
    ? sql` WHERE ${sql.join(conds, sql` AND `)}`
    : sql``
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDrizzleContentRepository<T>(
  db: DrizzlePostgresInstance,
  tableName: string,
  options: ContentRepositoryOptions = {}
): ContentRepository<T> {
  const { relations = {} } = options

  function tableRaw(): SQL {
    return sql.raw(quoteIdent(tableName))
  }

  async function resolveRows(
    rows: Record<string, unknown>[],
    include: string[],
    cache: Map<string, unknown>
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return rows

    // Validate include fields
    for (const fieldName of include) {
      if (!relations[fieldName]) {
        throw codeError('INVALID_INCLUDE_FIELD', `'${fieldName}' is not a valid relation field`)
      }
    }

    // Always resolve media fields; for all other relations not explicitly
    // included, populate bare IDs so the field is never silently dropped.
    for (const [fieldName, rel] of Object.entries(relations)) {
      if (rel.type === 'media') {
        await resolveRelationField(db, rows, fieldName, rel, cache)
      } else if (!include.includes(fieldName)) {
        await resolveRelationBareIds(db, rows, fieldName, rel)
      }
    }

    // Resolve explicitly included non-media fields
    for (const fieldName of include) {
      const rel = relations[fieldName]!
      if (rel.type !== 'media') {
        await resolveRelationField(db, rows, fieldName, rel, cache)
      }
    }

    return rows
  }

  return {
    async findMany(opts: FindManyOptions): Promise<PaginatedResult<T>> {
      const {
        page = 1,
        per_page = 10,
        include = [],
        published_only,
        filters,
        sort_by = 'created_at',
        sort_order = 'asc',
        search,
      } = opts

      if (!SORTABLE_FIELDS.has(sort_by as string)) {
        throw codeError('INVALID_SORT_FIELD', `'${sort_by}' is not sortable. Allowed: title, created_at, updated_at`)
      }

      const offset = (page - 1) * per_page
      const conds = buildConditions(published_only, filters, search)
      const where = whereFragment(conds)
      const sortCol = sql.raw(quoteIdent(sort_by))
      const sortDir = sql.raw(sort_order === 'desc' ? 'DESC' : 'ASC')

      const countResult = await db.execute(
        sql`SELECT COUNT(*) AS total FROM ${tableRaw()}${where}`
      )
      const total = Number((countResult.rows[0] as Record<string, unknown>)?.['total'] ?? 0)

      const dataResult = await db.execute(
        sql`SELECT * FROM ${tableRaw()}${where} ORDER BY ${sortCol} ${sortDir} LIMIT ${per_page} OFFSET ${offset}`
      )

      const rows = dataResult.rows as Record<string, unknown>[]
      const cache = new Map<string, unknown>()
      await resolveRows(rows, include, cache)

      const total_pages = Math.ceil(total / per_page)
      return {
        ok: true,
        data: rows as T[],
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

    async findOne(id: string, include: string[] = []): Promise<T | null> {
      const result = await db.execute(
        sql`SELECT * FROM ${tableRaw()} WHERE id = ${id} LIMIT 1`
      )
      if (result.rows.length === 0) return null

      const rows = result.rows as Record<string, unknown>[]
      const cache = new Map<string, unknown>()
      await resolveRows(rows, include, cache)
      return rows[0] as T
    },

    async findBySlug(slug: string, include: string[] = []): Promise<T | null> {
      const result = await db.execute(
        sql`SELECT * FROM ${tableRaw()} WHERE slug = ${slug} LIMIT 1`
      )
      if (result.rows.length === 0) return null

      const rows = result.rows as Record<string, unknown>[]
      const cache = new Map<string, unknown>()
      await resolveRows(rows, include, cache)
      return rows[0] as T
    },

    async create(data: CreateInput<T>): Promise<T> {
      const record: Record<string, unknown> = {
        ...(data as Record<string, unknown>),
        id: crypto.randomUUID(),
        created_at: new Date(),
        updated_at: new Date(),
      }
      const entries = Object.entries(record).filter(([, v]) => v !== undefined)
      const colsSql = sql.join(entries.map(([k]) => sql.raw(quoteIdent(k))), sql`, `)
      const valsSql = sql.join(entries.map(([, v]) => sql`${v}`), sql`, `)

      const result = await db.execute(
        sql`INSERT INTO ${tableRaw()} (${colsSql}) VALUES (${valsSql}) RETURNING *`
      )
      return result.rows[0] as T
    },

    async update(id: string, data: UpdateInput<T>): Promise<T | null> {
      const record: Record<string, unknown> = {
        ...(data as Record<string, unknown>),
        updated_at: new Date(),
      }
      const entries = Object.entries(record).filter(([k, v]) => k !== 'id' && v !== undefined)
      if (entries.length === 0) {
        return this.findOne(id)
      }

      const setClauses = sql.join(
        entries.map(([k, v]) => sql`${sql.raw(quoteIdent(k))} = ${v}`),
        sql`, `
      )

      const result = await db.execute(
        sql`UPDATE ${tableRaw()} SET ${setClauses} WHERE id = ${id} RETURNING *`
      )
      if (result.rows.length === 0) return null
      return result.rows[0] as T
    },

    async delete(id: string): Promise<void> {
      await db.execute(sql`DELETE FROM ${tableRaw()} WHERE id = ${id}`)
    },

    async findAll(opts: FindAllOptions = {}): Promise<T[]> {
      const { include = [], published_only } = opts
      const conds = buildConditions(published_only, undefined, undefined)
      const where = whereFragment(conds)

      const result = await db.execute(
        sql`SELECT * FROM ${tableRaw()}${where} ORDER BY created_at ASC`
      )

      const rows = result.rows as Record<string, unknown>[]
      const cache = new Map<string, unknown>()
      await resolveRows(rows, include, cache)
      return rows as T[]
    },
  }
}
