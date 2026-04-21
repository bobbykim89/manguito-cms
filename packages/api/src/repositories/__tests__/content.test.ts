import { describe, it, expect, vi } from 'vitest'
import { createDrizzleContentRepository } from '../content'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// ─── SQL inspection helpers ───────────────────────────────────────────────────
//
// In drizzle-orm 0.45.x the SQL template tag stores query chunks as a plain
// Array where:
//   - SQL objects   → `{ queryChunks: SQLChunk[] }` (recurse)
//   - StringChunks  → `{ value: string[] }` (SQL text, not params)
//   - Parameters    → plain primitives (string | number | boolean) stored
//                     directly in the queryChunks array
//
// We inspect those structures without importing drizzle internals.

type AnyObj = Record<string, unknown>

function isSQLObj(node: unknown): node is AnyObj {
  return !!node && typeof node === 'object' && !Array.isArray(node) && 'queryChunks' in (node as AnyObj)
}

function isStringChunk(node: unknown): node is AnyObj {
  return !!node && typeof node === 'object' && !Array.isArray(node) && 'value' in (node as AnyObj) && !('queryChunks' in (node as AnyObj))
}

function* walkSQL(node: unknown): Generator<{ type: 'str'; value: string } | { type: 'param'; value: unknown }> {
  if (node === null || node === undefined) return

  // Plain primitive in queryChunks = SQL parameter value
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    yield { type: 'param', value: node }
    return
  }

  if (typeof node !== 'object') return

  if (isSQLObj(node)) {
    const chunks = (node as AnyObj)['queryChunks']
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) yield* walkSQL(chunk)
    }
    return
  }

  if (isStringChunk(node)) {
    const val = (node as AnyObj)['value']
    if (Array.isArray(val)) {
      for (const s of val) {
        if (typeof s === 'string' && s) yield { type: 'str', value: s }
      }
    }
    return
  }
}

function collectParams(sqlObj: unknown): unknown[] {
  const params: unknown[] = []
  for (const token of walkSQL(sqlObj)) {
    if (token.type === 'param') params.push(token.value)
  }
  return params
}

function toSQLText(sqlObj: unknown): string {
  const parts: string[] = []
  let n = 0
  for (const token of walkSQL(sqlObj)) {
    if (token.type === 'str') parts.push(token.value)
    else { n++; parts.push(`$${n}`) }
  }
  return parts.join('')
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeMockDb(countTotal: number, rows: unknown[] = []) {
  return {
    execute: vi.fn()
      .mockResolvedValueOnce({ rows: [{ total: countTotal }] }) // COUNT query
      .mockResolvedValueOnce({ rows }),                          // data query
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DrizzleContentRepository — findMany', () => {
  it('page=1 calculates OFFSET as 0', async () => {
    const mockDb = makeMockDb(0)
    const repo = createDrizzleContentRepository(mockDb as unknown as DrizzlePostgresInstance, 'test_table')

    await repo.findMany({ page: 1, per_page: 10 })

    const dataQuery = mockDb.execute.mock.calls[1]![0]
    const params = collectParams(dataQuery)
    // params = [..., per_page=10, offset=0]
    expect(params[params.length - 1]).toBe(0)
  })

  it('page=2 per_page=10 calculates OFFSET as 10', async () => {
    const mockDb = makeMockDb(25)
    const repo = createDrizzleContentRepository(mockDb as unknown as DrizzlePostgresInstance, 'test_table')

    await repo.findMany({ page: 2, per_page: 10 })

    const dataQuery = mockDb.execute.mock.calls[1]![0]
    const params = collectParams(dataQuery)
    expect(params[params.length - 1]).toBe(10)
  })

  it('returns correct total_pages, has_next, has_prev in meta', async () => {
    // total=25, per_page=10 → total_pages=3; page=2 → has_next=true, has_prev=true
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}` }))
    const mockDb = makeMockDb(25, rows)
    const repo = createDrizzleContentRepository(mockDb as unknown as DrizzlePostgresInstance, 'test_table')

    const result = await repo.findMany({ page: 2, per_page: 10 })

    expect(result.meta.total).toBe(25)
    expect(result.meta.total_pages).toBe(3)
    expect(result.meta.has_next).toBe(true)
    expect(result.meta.has_prev).toBe(true)
  })

  it('findMany with multi-value filter generates IN clause (OR within field)', async () => {
    const mockDb = makeMockDb(0)
    const repo = createDrizzleContentRepository(mockDb as unknown as DrizzlePostgresInstance, 'test_table')

    await repo.findMany({
      page: 1,
      per_page: 10,
      filters: { status: ['draft', 'review'] },
    })

    const countQuery = mockDb.execute.mock.calls[0]![0]
    const params = collectParams(countQuery)
    expect(params).toContain('draft')
    expect(params).toContain('review')

    const text = toSQLText(countQuery)
    expect(text.toUpperCase()).toContain('IN')
  })

  it('findMany with two different fields generates AND condition', async () => {
    const mockDb = makeMockDb(0)
    const repo = createDrizzleContentRepository(mockDb as unknown as DrizzlePostgresInstance, 'test_table')

    await repo.findMany({
      page: 1,
      per_page: 10,
      filters: { status: 'published', category: 'news' },
    })

    const countQuery = mockDb.execute.mock.calls[0]![0]
    const params = collectParams(countQuery)
    expect(params).toContain('published')
    expect(params).toContain('news')

    const text = toSQLText(countQuery)
    expect(text.toUpperCase()).toContain('AND')
  })
})
