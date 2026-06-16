import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptAdapter } from '../src/utils/prompt.js'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn().mockResolvedValue({
    schema: { dir: '/fake/schemas' },
    migrations: undefined,
    db: {},
    storage: {},
    server: {},
    api: { prefix: '/api', media: undefined },
    admin: { prefix: '/admin' },
  }),
}))
vi.mock('../src/codegen/drizzle-config.js', () => ({ generateDrizzleConfig: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/commands/build.js', () => ({
  runBuild: vi.fn().mockResolvedValue(undefined),
  needsRebuild: vi.fn().mockResolvedValue(false),
}))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  getMigrationStatus: vi.fn().mockResolvedValue({ applied: [], pending: [] }),
  generateMigration: vi.fn().mockResolvedValue([]),
  applyMigrations: vi.fn().mockResolvedValue({ applied: 0, skipped: 0 }),
  scanMigrationFiles: vi.fn().mockReturnValue({ hasDestructiveOperations: false, operations: [] }),
  seedSystemTables: vi.fn().mockResolvedValue({
    roles: { inserted: 0, updated: 0, deleted: 0 },
    base_paths: { inserted: 0, updated: 0, deleted: 0 },
  }),
  createPostgresAdapter: vi.fn(),
  sql: vi.fn(),
}))
vi.mock('@bobbykim/manguito-cms-core', () => ({
  walkSchemaDirectory: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseSchema: vi.fn(),
  parseRoles: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseRoutes: vi.fn().mockReturnValue({ ok: true, value: [] }),
  buildSchemaRegistry: vi.fn().mockReturnValue({}),
  loadSchemaFile: vi.fn().mockReturnValue({ ok: true, value: '{}' }),
}))

import { runMigrate } from '../src/commands/migrate.js'
import {
  getMigrationStatus,
  generateMigration,
  applyMigrations,
  scanMigrationFiles,
  seedSystemTables,
} from '@bobbykim/manguito-cms-db'
import {
  walkSchemaDirectory,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
} from '@bobbykim/manguito-cms-core'
import { resolveConfig } from '../src/utils/config.js'
import { generateDrizzleConfig } from '../src/codegen/drizzle-config.js'

const MIGRATIONS_FOLDER = '/fake/migrations'
const CONFIG_PATH = '/fake/dist/generated/drizzle.config.ts'

function makeDeps(overrides: Partial<Parameters<typeof runMigrate>[1]> = {}): Parameters<typeof runMigrate>[1] {
  const mockExecute = vi.fn().mockResolvedValue({ rows: [] })
  const mockDb = {
    connect: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockReturnValue({ execute: mockExecute }),
    isConnected: vi.fn().mockReturnValue(true),
    tableExists: vi.fn().mockResolvedValue(true),
  }
  const mockPrompt: PromptAdapter = {
    input: vi.fn().mockResolvedValue(''),
    password: vi.fn().mockResolvedValue(''),
    confirm: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue(''),
  }
  return {
    buildRunner: vi.fn().mockResolvedValue(undefined),
    needsRebuild: vi.fn().mockResolvedValue(false),
    db: mockDb as unknown as Parameters<typeof runMigrate>[1]['db'],
    migrationsFolder: MIGRATIONS_FOLDER,
    configPath: CONFIG_PATH,
    prompt: mockPrompt,
    ...overrides,
  }
}

describe('runMigrate', () => {
  const MOCK_CONFIG = {
    schema: { dir: '/fake/schemas' },
    migrations: undefined,
    db: {},
    storage: {},
    server: {},
    api: { prefix: '/api', media: undefined },
    admin: { prefix: '/admin' },
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(resolveConfig).mockResolvedValue(MOCK_CONFIG as never)
    vi.mocked(generateDrizzleConfig).mockResolvedValue(undefined)
    vi.mocked(getMigrationStatus).mockResolvedValue({ applied: [], pending: [] })
    vi.mocked(generateMigration).mockResolvedValue([])
    vi.mocked(applyMigrations).mockResolvedValue({ applied: 0, skipped: 0 })
    vi.mocked(scanMigrationFiles).mockReturnValue({ hasDestructiveOperations: false, operations: [] })
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

  describe('--status', () => {
    it('calls getMigrationStatus and does not trigger build or needsRebuild', async () => {
      vi.mocked(getMigrationStatus).mockResolvedValue({
        applied: ['0001_initial.sql'],
        pending: [],
      })
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      const deps = makeDeps()

      await expect(runMigrate({ status: true }, deps)).rejects.toThrow('process.exit')

      expect(getMigrationStatus).toHaveBeenCalled()
      expect(deps.buildRunner).not.toHaveBeenCalled()
      expect(deps.needsRebuild).not.toHaveBeenCalled()
      exitSpy.mockRestore()
    })
  })

  describe('standard flow — no destructive ops', () => {
    it('calls all steps in order and succeeds', async () => {
      vi.mocked(generateMigration).mockResolvedValue([])
      vi.mocked(applyMigrations).mockResolvedValue({ applied: 0, skipped: 0 })
      vi.mocked(seedSystemTables).mockResolvedValue({
        roles: { inserted: 0, updated: 0, deleted: 0 },
        base_paths: { inserted: 0, updated: 0, deleted: 0 },
      })
      const deps = makeDeps()

      await runMigrate({}, deps)

      expect(deps.needsRebuild).toHaveBeenCalled()
      expect(generateMigration).toHaveBeenCalled()
      expect(applyMigrations).toHaveBeenCalled()
      expect(seedSystemTables).toHaveBeenCalled()
    })

    it('skips buildRunner when needsRebuild returns false', async () => {
      const deps = makeDeps()
      vi.mocked(deps.needsRebuild).mockResolvedValue(false)

      await runMigrate({}, deps)

      expect(deps.buildRunner).not.toHaveBeenCalled()
    })

    it('runs buildRunner when needsRebuild returns true', async () => {
      const deps = makeDeps()
      vi.mocked(deps.needsRebuild).mockResolvedValue(true)

      await runMigrate({}, deps)

      expect(deps.buildRunner).toHaveBeenCalled()
    })
  })

  describe('destructive ops without --force', () => {
    it('calls prompt.confirm when destructive ops are found', async () => {
      vi.mocked(generateMigration).mockResolvedValueOnce(['0002_drop_col.sql'])
      vi.mocked(scanMigrationFiles).mockReturnValueOnce({
        hasDestructiveOperations: true,
        operations: [{ operation: 'DROP COLUMN blog_post.summary', file: '0002_drop_col.sql', pattern: 'DROP_COLUMN' as const }],
      })
      const deps = makeDeps()

      await runMigrate({}, deps)

      expect(deps.prompt.confirm).toHaveBeenCalled()
    })
  })

  describe('destructive ops with --force', () => {
    it('does not call prompt.confirm and continues immediately', async () => {
      vi.mocked(generateMigration).mockResolvedValueOnce(['0002_drop_col.sql'])
      vi.mocked(scanMigrationFiles).mockReturnValueOnce({
        hasDestructiveOperations: true,
        operations: [{ operation: 'DROP COLUMN blog_post.summary', file: '0002_drop_col.sql', pattern: 'DROP_COLUMN' as const }],
      })
      const deps = makeDeps()

      await runMigrate({ force: true }, deps)

      expect(deps.prompt.confirm).not.toHaveBeenCalled()
      expect(applyMigrations).toHaveBeenCalled()
    })
  })

  describe('--dry-run', () => {
    it('does not call applyMigrations or seedSystemTables', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      const deps = makeDeps()

      await expect(runMigrate({ dryRun: true }, deps)).rejects.toThrow('process.exit')

      expect(applyMigrations).not.toHaveBeenCalled()
      expect(seedSystemTables).not.toHaveBeenCalled()
      exitSpy.mockRestore()
    })
  })

  describe('buildRunner fails', () => {
    it('stops execution and surfaces the error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      const deps = makeDeps()
      vi.mocked(deps.needsRebuild).mockResolvedValue(true)
      vi.mocked(deps.buildRunner).mockRejectedValue(new Error('Compilation error'))

      await expect(runMigrate({}, deps)).rejects.toThrow('process.exit')

      expect(generateMigration).not.toHaveBeenCalled()
      expect(applyMigrations).not.toHaveBeenCalled()
      expect(exitSpy).toHaveBeenCalledWith(1)
      exitSpy.mockRestore()
    })
  })
})
