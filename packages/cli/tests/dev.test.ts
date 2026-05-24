import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({ resolveConfig: vi.fn() }))
vi.mock('../src/utils/db.js', () => ({ connectDb: vi.fn() }))
vi.mock('../src/utils/prompt.js', () => ({ createPromptAdapter: vi.fn() }))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  sql: vi.fn(),
  runDevMigration: vi.fn().mockResolvedValue(undefined),
  seedSystemTables: vi.fn().mockResolvedValue({
    roles: { inserted: 0, updated: 0, deleted: 0 },
    base_paths: { inserted: 0, updated: 0, deleted: 0 },
  }),
  generateSchemaFile: vi.fn().mockReturnValue('// generated'),
  createPostgresAdapter: vi.fn(),
}))
vi.mock('@bobbykim/manguito-cms-api', () => ({
  createAPIAdapter: vi.fn().mockReturnValue({ app: { fetch: vi.fn() } }),
}))
vi.mock('@bobbykim/manguito-cms-core', () => ({
  walkSchemaDirectory: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseSchema: vi.fn(),
  parseRoles: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseRoutes: vi.fn().mockReturnValue({ ok: true, value: [] }),
  buildSchemaRegistry: vi.fn().mockReturnValue({ content_types: {}, paragraph_types: {}, taxonomy_types: {} }),
  loadSchemaFile: vi.fn().mockReturnValue({ ok: true, value: '{}' }),
  hashPassword: vi.fn().mockResolvedValue('hashed-pw'),
}))
vi.mock('../src/codegen/drizzle-config.js', () => ({ generateDrizzleConfig: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/codegen/registry.js', () => ({ generateSchemaRegistry: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/codegen/routes.js', () => ({ generateRoutes: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/codegen/forms.js', () => ({ generateForms: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/codegen/nav.js', () => ({ generateNav: vi.fn().mockResolvedValue(undefined) }))
vi.mock('vite', () => ({
  createServer: vi.fn().mockResolvedValue({ middlewares: vi.fn() }),
}))
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return { ...actual, createServer: vi.fn().mockReturnValue({ listen: vi.fn() }) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]() {
        return { next: async () => ({ done: true as const, value: undefined }) }
      },
    }),
  }
})

import { runDev } from '../src/commands/dev.js'
import { connectDb } from '../src/utils/db.js'
import { resolveConfig } from '../src/utils/config.js'
import { createPromptAdapter } from '../src/utils/prompt.js'
import { walkSchemaDirectory, parseRoles, parseRoutes, buildSchemaRegistry, loadSchemaFile } from '@bobbykim/manguito-cms-core'
import { createAPIAdapter } from '@bobbykim/manguito-cms-api'
import { createServer as createViteServer } from 'vite'
import { createServer as httpCreateServer } from 'node:http'
import { generateDrizzleConfig } from '../src/codegen/drizzle-config.js'
import { generateSchemaRegistry } from '../src/codegen/registry.js'
import { generateRoutes } from '../src/codegen/routes.js'
import { generateForms } from '../src/codegen/forms.js'
import { generateNav } from '../src/codegen/nav.js'
import { watch as fsWatch } from 'node:fs/promises'

const FAKE_CWD = '/fake/project'
const MOCK_CONFIG = {
  schema: { base_path: 'schemas', dir: '/fake/schemas' },
  migrations: undefined,
  db: {},
  storage: { type: 'local' },
  server: {},
  api: { prefix: '/api' },
  admin: { prefix: '/admin' },
}

function makeDb(executeResponses: Array<{ rows: unknown[] }> = [], tableExists = true) {
  const execute = vi.fn()
  for (const response of executeResponses) {
    execute.mockResolvedValueOnce(response)
  }
  execute.mockResolvedValue({ rows: [] })
  return {
    isConnected: vi.fn().mockReturnValue(true),
    tableExists: vi.fn().mockResolvedValue(tableExists),
    connect: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockReturnValue({ execute }),
    _execute: execute,
  }
}

const mockPrompt = {
  input: vi.fn().mockResolvedValue('admin@example.com'),
  password: vi.fn().mockResolvedValue('Password1!'),
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockResolvedValue(''),
}

describe('runDev', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(resolveConfig).mockResolvedValue(MOCK_CONFIG as never)
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [] })
    vi.mocked(loadSchemaFile).mockReturnValue({ ok: true, value: '{}' })
    vi.mocked(parseRoles).mockReturnValue({ ok: true, value: [] } as never)
    vi.mocked(parseRoutes).mockReturnValue({ ok: true, value: [] } as never)
    vi.mocked(buildSchemaRegistry).mockReturnValue({ content_types: {}, paragraph_types: {}, taxonomy_types: {} } as never)
    vi.mocked(generateDrizzleConfig).mockResolvedValue(undefined)
    vi.mocked(generateSchemaRegistry).mockResolvedValue(undefined)
    vi.mocked(generateRoutes).mockResolvedValue(undefined)
    vi.mocked(generateForms).mockResolvedValue(undefined)
    vi.mocked(generateNav).mockResolvedValue(undefined)
    vi.mocked(createAPIAdapter).mockReturnValue({ app: { fetch: vi.fn() } } as never)
    vi.mocked(createViteServer).mockResolvedValue({ middlewares: vi.fn() } as never)
    vi.mocked(httpCreateServer).mockReturnValue({ listen: vi.fn() } as never)
    vi.mocked(fsWatch).mockReturnValue({
      [Symbol.asyncIterator]() {
        return { next: async () => ({ done: true as const, value: undefined }) }
      },
    } as never)
    mockPrompt.input.mockResolvedValue('admin@example.com')
    mockPrompt.password.mockResolvedValue('Password1!')
    mockPrompt.confirm.mockResolvedValue(true)
    mockPrompt.select.mockResolvedValue('')
    vi.mocked(createPromptAdapter).mockReturnValue(mockPrompt)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('calls all key startup steps when existing admin is present', async () => {
    // tablesExist=true, adminCount=1 — normal startup, no first-run prompts
    const db = makeDb([{ rows: [{ count: 1 }] }])
    vi.mocked(connectDb).mockResolvedValue(db as never)

    await runDev({}, { cwd: FAKE_CWD })

    expect(connectDb).toHaveBeenCalled()
    expect(db.tableExists).toHaveBeenCalledWith('users')
    expect(walkSchemaDirectory).toHaveBeenCalled()
    expect(generateDrizzleConfig).toHaveBeenCalled()
    expect(generateSchemaRegistry).toHaveBeenCalled()
    expect(generateRoutes).toHaveBeenCalled()
    expect(generateForms).toHaveBeenCalled()
    expect(generateNav).toHaveBeenCalled()
    expect(createAPIAdapter).toHaveBeenCalled()
    expect(createViteServer).toHaveBeenCalled()
    expect(httpCreateServer).toHaveBeenCalled()
  })

  it('triggers first-admin prompt when no admin user exists in DB', async () => {
    // adminCount=0 → prompt for credentials, role lookup, INSERT
    const db = makeDb([
      { rows: [{ count: 0 }] },              // admin count
      { rows: [{ id: 'role-admin' }] },       // role lookup
      { rows: [] },                           // INSERT
    ])
    vi.mocked(connectDb).mockResolvedValue(db as never)

    await runDev({}, { cwd: FAKE_CWD })

    expect(mockPrompt.input).toHaveBeenCalled()
    expect(mockPrompt.password).toHaveBeenCalled()
  })

  it('skips first-admin prompt when an admin user already exists', async () => {
    // adminCount=1 → no prompts
    const db = makeDb([{ rows: [{ count: 1 }] }])
    vi.mocked(connectDb).mockResolvedValue(db as never)

    await runDev({}, { cwd: FAKE_CWD })

    expect(mockPrompt.input).not.toHaveBeenCalled()
    expect(mockPrompt.password).not.toHaveBeenCalled()
  })

  it('exits with guided error and does not start the server when schema parse fails', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const db = makeDb([{ rows: [{ count: 1 }] }])
    vi.mocked(connectDb).mockResolvedValue(db as never)
    vi.mocked(walkSchemaDirectory).mockReturnValue({
      ok: false,
      errors: [{ file: 'schemas/blog.json', message: 'unknown field type' }],
    } as never)

    await expect(runDev({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(createViteServer).not.toHaveBeenCalled()
    expect(httpCreateServer).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})
