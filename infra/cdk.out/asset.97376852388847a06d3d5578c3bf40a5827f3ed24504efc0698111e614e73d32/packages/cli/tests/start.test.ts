import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({ resolveConfig: vi.fn() }))
vi.mock('../src/utils/db.js', () => ({ connectDb: vi.fn() }))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  getMigrationStatus: vi.fn(),
  seedSystemTables: vi.fn(),
}))
vi.mock('@bobbykim/manguito-cms-core', () => ({
  walkSchemaDirectory: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseSchema: vi.fn(),
  parseRoles: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseRoutes: vi.fn().mockReturnValue({ ok: true, value: [] }),
  buildSchemaRegistry: vi.fn().mockReturnValue({}),
  loadSchemaFile: vi.fn().mockReturnValue({ ok: true, value: '{}' }),
}))

import { runStart } from '../src/commands/start.js'
import { connectDb } from '../src/utils/db.js'
import { resolveConfig } from '../src/utils/config.js'
import { getMigrationStatus, seedSystemTables } from '@bobbykim/manguito-cms-db'
import {
  walkSchemaDirectory,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
} from '@bobbykim/manguito-cms-core'

const FAKE_CWD = '/fake/project'
const MOCK_CONFIG = {
  schema: { base_path: 'schemas', dir: '/fake/schemas' },
  migrations: undefined,
  db: {},
  storage: {},
  server: {},
  api: { prefix: '/api', media: undefined },
  admin: { prefix: '/admin' },
}

function makeDb(tableExists = true) {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    tableExists: vi.fn().mockResolvedValue(tableExists),
    connect: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) }),
  }
}

describe('runStart', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(resolveConfig).mockResolvedValue(MOCK_CONFIG as never)
    vi.mocked(getMigrationStatus).mockResolvedValue({ applied: [], pending: [] })
    vi.mocked(seedSystemTables).mockResolvedValue({
      roles: { inserted: 0, updated: 0, deleted: 0 },
      base_paths: { inserted: 0, updated: 0, deleted: 0 },
    })
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [] })
    vi.mocked(loadSchemaFile).mockReturnValue({ ok: true, value: '{}' })
    vi.mocked(parseRoles).mockReturnValue({ ok: true, value: [] } as never)
    vi.mocked(parseRoutes).mockReturnValue({ ok: true, value: [] } as never)
    vi.mocked(buildSchemaRegistry).mockReturnValue({} as never)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  describe('Scenario A — migration table does not exist', () => {
    it('blocks with guided error and calls process.exit(1) before loading the server', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      const db = makeDb(false)
      vi.mocked(connectDb).mockResolvedValue(db as never)
      const loadServer = vi.fn()

      await expect(runStart({}, { cwd: FAKE_CWD, loadServer })).rejects.toThrow('process.exit')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('not been initialized'))
      expect(loadServer).not.toHaveBeenCalled()
      exitSpy.mockRestore()
    })
  })

  describe('Scenario B — pending migrations exist', () => {
    it('prints warning, does not exit, and loads the server', async () => {
      const db = makeDb()
      vi.mocked(connectDb).mockResolvedValue(db as never)
      vi.mocked(getMigrationStatus).mockResolvedValue({
        applied: ['0001_initial.sql'],
        pending: ['0002_pending.sql'],
      })
      const loadServer = vi.fn().mockResolvedValue(undefined)

      await runStart({}, { cwd: FAKE_CWD, loadServer })

      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('pending migrations'))
      expect(loadServer).toHaveBeenCalled()
    })
  })

  describe('Scenario C — all migrations applied', () => {
    it('loads the server without printing a pending-migrations warning', async () => {
      const db = makeDb()
      vi.mocked(connectDb).mockResolvedValue(db as never)
      vi.mocked(getMigrationStatus).mockResolvedValue({ applied: ['0001_initial.sql'], pending: [] })
      const loadServer = vi.fn().mockResolvedValue(undefined)

      await runStart({}, { cwd: FAKE_CWD, loadServer })

      expect(process.stdout.write).not.toHaveBeenCalledWith(expect.stringContaining('pending migrations'))
      expect(loadServer).toHaveBeenCalled()
    })
  })
})
