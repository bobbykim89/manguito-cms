import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptAdapter } from '../src/utils/prompt.js'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn().mockResolvedValue({
    db: {}, storage: {}, server: {}, api: { prefix: '/api' }, admin: { prefix: '/admin' },
  }),
}))
vi.mock('@bobbykim/manguito-cms-core', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-pw'),
}))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  sql: vi.fn(),
  createPostgresAdapter: vi.fn(),
}))

import { runCreateSuperuser } from '../src/commands/createsuperuser.js'
import { hashPassword } from '@bobbykim/manguito-cms-core'

function makeExecute() {
  return vi.fn()
}

function makeDb(overrides: Partial<{
  isConnected: boolean
  usersTableExists: boolean
  execute: ReturnType<typeof makeExecute>
}> = {}) {
  const execute = overrides.execute ?? makeExecute()
  return {
    isConnected: vi.fn().mockReturnValue(overrides.isConnected ?? true),
    tableExists: vi.fn().mockResolvedValue(overrides.usersTableExists ?? true),
    connect: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockReturnValue({ execute }),
    _execute: execute,
  }
}

function makePrompt(overrides: Partial<PromptAdapter> = {}): PromptAdapter {
  return {
    input: vi.fn().mockResolvedValue('admin@example.com'),
    password: vi.fn().mockResolvedValue('ValidPass1'),
    confirm: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue(''),
    ...overrides,
  }
}

const DEFAULT_ROLE = { id: 'role-1', name: 'admin' }

describe('runCreateSuperuser', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(hashPassword).mockResolvedValue('hashed-pw')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('exits with guided error when DB is not connected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const db = makeDb({ isConnected: false })
    const prompt = makePrompt()

    await expect(runCreateSuperuser({}, { db: db as never, prompt })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Cannot connect'))
    exitSpy.mockRestore()
  })

  it('exits with guided error pointing to migrate when users table is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const db = makeDb({ usersTableExists: false })
    const prompt = makePrompt()

    await expect(runCreateSuperuser({}, { db: db as never, prompt })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('manguito migrate'))
    exitSpy.mockRestore()
  })

  it('exits with guided error pointing to migrate when no roles exist in DB', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const execute = makeExecute().mockResolvedValueOnce({ rows: [{ count: 0 }] })
    const db = makeDb({ execute })
    const prompt = makePrompt()

    await expect(runCreateSuperuser({}, { db: db as never, prompt })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('manguito migrate'))
    exitSpy.mockRestore()
  })

  it('re-prompts email on invalid format without calling the DB uniqueness check', async () => {
    const execute = makeExecute()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })   // roles count
      .mockResolvedValueOnce({ rows: [] })                 // uniqueness for valid email
      .mockResolvedValueOnce({ rows: [DEFAULT_ROLE] })     // role lookup
      .mockResolvedValueOnce({ rows: [] })                 // INSERT
    const db = makeDb({ execute })
    const prompt = makePrompt({
      input: vi.fn()
        .mockResolvedValueOnce('not-an-email')
        .mockResolvedValueOnce('admin@example.com'),
      password: vi.fn()
        .mockResolvedValueOnce('ValidPass1')
        .mockResolvedValueOnce('ValidPass1'),
    })

    await runCreateSuperuser({}, { db: db as never, prompt })

    expect(prompt.input).toHaveBeenCalledTimes(2)
    // uniqueness check called only once (after the valid email)
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('re-prompts both password fields when passwords do not match', async () => {
    const execute = makeExecute()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })   // roles count
      .mockResolvedValueOnce({ rows: [] })                 // uniqueness
      .mockResolvedValueOnce({ rows: [DEFAULT_ROLE] })     // role lookup
      .mockResolvedValueOnce({ rows: [] })                 // INSERT
    const db = makeDb({ execute })
    const prompt = makePrompt({
      password: vi.fn()
        .mockResolvedValueOnce('ValidPass1')   // first attempt
        .mockResolvedValueOnce('WrongPass2')   // mismatch — re-prompt
        .mockResolvedValueOnce('ValidPass1')   // second attempt
        .mockResolvedValueOnce('ValidPass1'),  // confirm matches
    })

    await runCreateSuperuser({}, { db: db as never, prompt })

    expect(prompt.password).toHaveBeenCalledTimes(4)
  })

  it('re-prompts password when it is too short', async () => {
    const execute = makeExecute()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [DEFAULT_ROLE] })
      .mockResolvedValueOnce({ rows: [] })
    const db = makeDb({ execute })
    const prompt = makePrompt({
      password: vi.fn()
        .mockResolvedValueOnce('sh0rt')       // too short (< 8 chars)
        .mockResolvedValueOnce('ValidPass1')  // valid
        .mockResolvedValueOnce('ValidPass1'), // confirm
    })

    await runCreateSuperuser({}, { db: db as never, prompt })

    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('at least 8 characters'),
    )
    expect(prompt.password).toHaveBeenCalledTimes(3)
  })

  it('re-prompts email when it already exists in the DB', async () => {
    const execute = makeExecute()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })         // roles count
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] })   // email taken
      .mockResolvedValueOnce({ rows: [] })                       // second email not taken
      .mockResolvedValueOnce({ rows: [DEFAULT_ROLE] })           // role lookup
      .mockResolvedValueOnce({ rows: [] })                       // INSERT
    const db = makeDb({ execute })
    const prompt = makePrompt({
      input: vi.fn()
        .mockResolvedValueOnce('taken@example.com')
        .mockResolvedValueOnce('fresh@example.com'),
      password: vi.fn()
        .mockResolvedValueOnce('ValidPass1')
        .mockResolvedValueOnce('ValidPass1'),
    })

    await runCreateSuperuser({}, { db: db as never, prompt })

    expect(prompt.input).toHaveBeenCalledTimes(2)
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    )
  })

  it('calls INSERT with hashed password and correct role_id on success', async () => {
    vi.mocked(hashPassword).mockResolvedValue('hashed-secret')
    const execute = makeExecute()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })                   // roles count
      .mockResolvedValueOnce({ rows: [] })                                 // uniqueness
      .mockResolvedValueOnce({ rows: [{ id: 'role-admin', name: 'admin' }] }) // role lookup
      .mockResolvedValueOnce({ rows: [] })                                 // INSERT
    const db = makeDb({ execute })
    const prompt = makePrompt({
      input: vi.fn().mockResolvedValue('new@example.com'),
      password: vi.fn()
        .mockResolvedValueOnce('ValidPass1')
        .mockResolvedValueOnce('ValidPass1'),
    })

    await runCreateSuperuser({}, { db: db as never, prompt })

    // hashPassword was called with the entered password
    expect(hashPassword).toHaveBeenCalledWith('ValidPass1')
    // All four DB queries ran: roles count, uniqueness check, role lookup, INSERT
    expect(execute).toHaveBeenCalledTimes(4)
    // sql is a tagged template literal — its mock records interpolated values as positional args.
    // INSERT call is the 4th (index 3): sql`INSERT ... VALUES (${userId}, ${email}, ${passwordHash}, ${roleId}, ...)`
    // positional args: [stringsArray, userId, email, passwordHash, roleId]
    const { sql: sqlFn } = await import('@bobbykim/manguito-cms-db')
    const insertCallArgs = vi.mocked(sqlFn).mock.calls[3] as unknown[]
    expect(insertCallArgs[3]).toBe('hashed-secret')   // passwordHash
    expect(insertCallArgs[4]).toBe('role-admin')      // roleId
  })
})
