import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPostgresAdapter } from '../postgres'

const DB_URL = process.env['DB_URL']

if (!DB_URL) {
  throw new Error('DB_URL must be set in .env.test before running integration tests')
}

// ─── Factory-level errors (no connection needed) ──────────────────────────────

describe('createPostgresAdapter — factory errors', () => {
  it('throws DB_URL_MISSING when no URL provided', () => {
    const saved = process.env['DB_URL']
    delete process.env['DB_URL']
    try {
      expect(() => createPostgresAdapter()).toThrow('DB_URL_MISSING')
    } finally {
      if (saved !== undefined) process.env['DB_URL'] = saved
    }
  })

  it('throws DB_URL_INVALID for non-postgres URL', () => {
    expect(() =>
      createPostgresAdapter({ url: 'mysql://localhost/test' }),
    ).toThrow('DB_URL_INVALID')
  })

  it('throws DB_URL_INVALID for http URL', () => {
    expect(() =>
      createPostgresAdapter({ url: 'http://localhost/test' }),
    ).toThrow('DB_URL_INVALID')
  })
})

// ─── Lifecycle — connect / disconnect / getDb ─────────────────────────────────

describe('createPostgresAdapter — lifecycle', () => {
  it('getDb() throws before connect()', () => {
    const adapter = createPostgresAdapter({ url: DB_URL })
    expect(() => adapter.getDb()).toThrow('DB not connected')
  })

  it('isConnected() returns false before connect()', () => {
    const adapter = createPostgresAdapter({ url: DB_URL })
    expect(adapter.isConnected()).toBe(false)
  })

  it('isConnected() returns true after connect, false after disconnect', async () => {
    const adapter = createPostgresAdapter({ url: DB_URL })
    await adapter.connect()
    expect(adapter.isConnected()).toBe(true)
    await adapter.disconnect()
    expect(adapter.isConnected()).toBe(false)
  })
})

// ─── Connected operations ─────────────────────────────────────────────────────

describe('createPostgresAdapter — connected operations', () => {
  const adapter = createPostgresAdapter({ url: DB_URL })

  beforeAll(async () => {
    await adapter.connect()
  })

  afterAll(async () => {
    await adapter.disconnect()
  })

  it('connect() succeeds with valid URL', () => {
    expect(adapter.isConnected()).toBe(true)
  })

  it('tableExists() returns false for a non-existent table', async () => {
    const exists = await adapter.tableExists('__nonexistent_xyz_table_abc__')
    expect(exists).toBe(false)
  })

  it('getTableNames() returns an array', async () => {
    const names = await adapter.getTableNames()
    expect(Array.isArray(names)).toBe(true)
  })
})
