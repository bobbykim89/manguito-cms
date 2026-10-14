import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptAdapter } from '../src/utils/prompt.js'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn().mockResolvedValue({
    schema: { base_path: '/fake/schemas' },
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
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  getMigrationStatus: vi.fn().mockResolvedValue({ applied: [], pending: [] }),
  generateMigration: vi.fn().mockResolvedValue([]),
  previewMigration: vi.fn().mockResolvedValue([]),
  scanMigrationSql: vi.fn().mockReturnValue({ hasDestructiveOperations: false, operations: [] }),
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
  previewMigration,
  applyMigrations,
  scanMigrationFiles,
  scanMigrationSql,
  seedSystemTables,
} from '@bobbykim/manguito-cms-db'
import {
  walkSchemaDirectory,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
} from '@bobbykim/manguito-cms-core'
import { readFile } from 'node:fs/promises'
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
    schema: { base_path: '/fake/schemas' },
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
    vi.mocked(previewMigration).mockResolvedValue([])
    vi.mocked(scanMigrationSql).mockReturnValue({ hasDestructiveOperations: false, operations: [] })
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

  describe('pending migrations generated earlier', () => {
    it('are scanned before applying, though this run generates nothing', async () => {
      // MUTATION: scan only the files this run generated. A destructive
      // migration an older --dry-run left in migrations/ is then applied with
      // no warning and no prompt.
      vi.mocked(generateMigration).mockResolvedValueOnce([])
      vi.mocked(getMigrationStatus).mockResolvedValue({ applied: [], pending: ['0001_left_behind.sql'] })
      const deps = makeDeps()

      await runMigrate({}, deps)

      expect(scanMigrationFiles).toHaveBeenCalledWith([`${MIGRATIONS_FOLDER}/0001_left_behind.sql`])
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

    it('previews the migration instead of generating it, and prints its SQL', async () => {
      // MUTATION: generate with generateMigration and print the new files (the
      // dry run before #72). The .sql, snapshot and journal then stay in
      // migrations/ although the output says nothing was written.
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      vi.mocked(previewMigration).mockResolvedValue([
        { name: '0001_add_note.sql', sql: 'ALTER TABLE "content_post" ADD COLUMN "note" varchar(255);' },
      ])

      await expect(runMigrate({ dryRun: true }, makeDeps())).rejects.toThrow('process.exit')

      expect(previewMigration).toHaveBeenCalledWith(CONFIG_PATH, MIGRATIONS_FOLDER)
      expect(generateMigration).not.toHaveBeenCalled()
      const out = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('')
      expect(out).toContain('ADD COLUMN "note"')
      expect(out).toContain('no migration files written')
      expect(exitSpy).toHaveBeenCalledWith(0)
      exitSpy.mockRestore()
    })

    it('shows a pending migration generated earlier, with its SQL, and flags it when destructive', async () => {
      // MUTATION: preview only the migration this run would generate. A
      // pending destructive migration is then missing from the dry run, which
      // reports "No new migration" although `migrate` would apply it.
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      vi.mocked(getMigrationStatus).mockResolvedValue({ applied: [], pending: ['0001_left_behind.sql'] })
      vi.mocked(readFile).mockResolvedValue('ALTER TABLE "t" DROP COLUMN "c";' as never)
      vi.mocked(scanMigrationSql).mockImplementation((ms) => ({
        hasDestructiveOperations: ms.some((m) => m.sql.includes('DROP COLUMN')),
        operations: ms.filter((m) => m.sql.includes('DROP COLUMN')).map((m) => ({ file: m.name, operation: 'DROP COLUMN t.c', pattern: 'DROP_COLUMN' as const })),
      }))

      await expect(runMigrate({ dryRun: true }, makeDeps())).rejects.toThrow('process.exit')

      const out = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('')
      expect(out).toContain('0001_left_behind.sql')
      expect(out).toContain('DROP COLUMN "c"')
      expect(out).toContain('DROP COLUMN t.c')
      exitSpy.mockRestore()
    })

    it('lists destructive operations without asking to apply them', async () => {
      // MUTATION: run the destructive-change prompt in a dry run too. It then
      // asks "Apply anyway?" for a command that applies nothing.
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
      vi.mocked(previewMigration).mockResolvedValue([{ name: '0002_drop.sql', sql: 'ALTER TABLE "t" DROP COLUMN "c";' }])
      vi.mocked(scanMigrationSql).mockReturnValue({
        hasDestructiveOperations: true,
        operations: [{ file: '0002_drop.sql', operation: 'DROP COLUMN t.c', pattern: 'DROP_COLUMN' }],
      })
      const deps = makeDeps()

      await expect(runMigrate({ dryRun: true }, deps)).rejects.toThrow('process.exit')

      expect(deps.prompt.confirm).not.toHaveBeenCalled()
      const out = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('')
      expect(out).toContain('DROP COLUMN t.c')
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
