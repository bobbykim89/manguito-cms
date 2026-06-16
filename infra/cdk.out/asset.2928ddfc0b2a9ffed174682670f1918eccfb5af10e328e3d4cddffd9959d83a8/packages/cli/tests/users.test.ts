import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptAdapter } from '../src/utils/prompt.js'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn().mockResolvedValue({
    db: {}, storage: {}, server: {}, api: { prefix: '/api' }, admin: { prefix: '/admin' },
  }),
}))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  sql: vi.fn(),
  createPostgresAdapter: vi.fn(),
}))

import { runUsersPromote, runUsersDemote } from '../src/commands/users.js'

const ADMIN_ROLE = { id: 'role-admin', name: 'admin' }
const EDITOR_ROLE = { id: 'role-editor', name: 'editor' }

function makeDb(executeResponses: Array<{ rows: unknown[] }>) {
  const execute = vi.fn()
  for (const response of executeResponses) {
    execute.mockResolvedValueOnce(response)
  }
  return {
    isConnected: vi.fn().mockReturnValue(true),
    tableExists: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockReturnValue({ execute }),
    _execute: execute,
  }
}

function makePrompt(overrides: Partial<PromptAdapter> = {}): PromptAdapter {
  return {
    input: vi.fn().mockResolvedValue('user@example.com'),
    password: vi.fn().mockResolvedValue(''),
    confirm: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue(EDITOR_ROLE.name),
    ...overrides,
  }
}

describe('runUsersPromote', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  // Call order in runUsersPromote:
  //   1. execute(SELECT id, role_id FROM users WHERE email...)
  //   2. execute(SELECT id, name FROM roles ORDER BY hierarchy_level ASC LIMIT 1)
  //   3. execute(UPDATE users SET role_id...) — only if not already top role

  it('warns and stops without UPDATE when user is already admin', async () => {
    const db = makeDb([
      { rows: [{ id: 'user-1', role_id: ADMIN_ROLE.id }] }, // user lookup: already admin
      { rows: [ADMIN_ROLE] },                                 // top role
    ])

    await runUsersPromote({ email: 'admin@example.com' }, { db: db as never, prompt: makePrompt() })

    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('already'))
    expect(db._execute).toHaveBeenCalledTimes(2) // no UPDATE
  })

  it('calls printGuidedError and exits when user is not found', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const db = makeDb([
      { rows: [] }, // user not found
    ])

    await expect(
      runUsersPromote({ email: 'nobody@example.com' }, { db: db as never, prompt: makePrompt() })
    ).rejects.toThrow('process.exit')

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('No user found'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('calls UPDATE with the highest-hierarchy role_id on success', async () => {
    const db = makeDb([
      { rows: [{ id: 'user-1', role_id: EDITOR_ROLE.id }] }, // user lookup: editor
      { rows: [ADMIN_ROLE] },                                  // top role
      { rows: [] },                                            // UPDATE
    ])

    await runUsersPromote({ email: 'user@example.com' }, { db: db as never, prompt: makePrompt() })

    expect(db._execute).toHaveBeenCalledTimes(3)
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('promoted'))
  })
})

describe('runUsersDemote', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  // Call order in runUsersDemote:
  //   1. execute(SELECT id, role_id FROM users WHERE email...)
  //   2. execute(SELECT id, name FROM roles ORDER BY hierarchy_level ASC LIMIT 1)  [top role]
  //   3. execute(SELECT id, name FROM roles WHERE id != topRole.id...)              [demote targets]
  //   4. execute(SELECT name FROM roles WHERE id = user.role_id...)   [only if targetRole === currentRole]
  //     OR
  //   4. execute(SELECT COUNT(*) FROM users WHERE role_id = topRole.id)             [last-admin guard, only if user holds top role]
  //   5. execute(UPDATE users SET role_id...)                                       [success path only]

  it('blocks with guided error when user is the last admin', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const db = makeDb([
      { rows: [{ id: 'user-1', role_id: ADMIN_ROLE.id }] }, // user: admin
      { rows: [ADMIN_ROLE] },                                 // top role
      { rows: [EDITOR_ROLE] },                               // demote targets
      { rows: [{ count: 1 }] },                              // last-admin guard: only 1 admin
    ])

    await expect(
      runUsersDemote({ email: 'user@example.com', role: EDITOR_ROLE.name }, { db: db as never, prompt: makePrompt() })
    ).rejects.toThrow('process.exit')

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('only admin'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('warns and stops without UPDATE when target role equals current role', async () => {
    const db = makeDb([
      { rows: [{ id: 'user-1', role_id: EDITOR_ROLE.id }] }, // user: editor
      { rows: [ADMIN_ROLE] },                                  // top role
      { rows: [EDITOR_ROLE] },                                 // demote targets
      { rows: [{ name: EDITOR_ROLE.name }] },                  // current role name lookup
    ])

    await runUsersDemote(
      { email: 'user@example.com', role: EDITOR_ROLE.name },
      { db: db as never, prompt: makePrompt() },
    )

    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('already assigned'))
    expect(db._execute).toHaveBeenCalledTimes(4) // no UPDATE
  })

  it('calls printGuidedError and exits when user is not found', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const db = makeDb([
      { rows: [] }, // user not found
    ])

    await expect(
      runUsersDemote({ email: 'ghost@example.com' }, { db: db as never, prompt: makePrompt() })
    ).rejects.toThrow('process.exit')

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('No user found'))
    exitSpy.mockRestore()
  })

  it('calls UPDATE with the correct role_id on success', async () => {
    const db = makeDb([
      { rows: [{ id: 'user-1', role_id: ADMIN_ROLE.id }] }, // user: admin
      { rows: [ADMIN_ROLE] },                                 // top role
      { rows: [EDITOR_ROLE] },                               // demote targets
      { rows: [{ count: 2 }] },                              // last-admin guard: 2 admins, safe
      { rows: [] },                                          // UPDATE
    ])

    await runUsersDemote(
      { email: 'user@example.com', role: EDITOR_ROLE.name },
      { db: db as never, prompt: makePrompt() },
    )

    expect(db._execute).toHaveBeenCalledTimes(5)
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('demoted'))
  })
})
