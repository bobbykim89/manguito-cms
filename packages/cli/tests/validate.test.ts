import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn().mockResolvedValue({
    schema: { dir: '/fake/schemas' },
    db: {},
    storage: {},
    server: {},
    api: { prefix: '/api', media: undefined },
    admin: { prefix: '/admin' },
  }),
}))
vi.mock('@bobbykim/manguito-cms-core', () => ({
  walkSchemaDirectory: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseSchema: vi.fn(),
  parseRoles: vi.fn().mockReturnValue({ ok: true, value: [] }),
  parseRoutes: vi.fn().mockReturnValue({ ok: true, value: [] }),
  buildSchemaRegistry: vi.fn().mockReturnValue({}),
  validateCrossReferences: vi.fn().mockReturnValue([]),
  loadSchemaFile: vi.fn().mockReturnValue({ ok: true, value: '{}' }),
}))

import { runValidate } from '../src/commands/validate.js'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
  validateCrossReferences,
} from '@bobbykim/manguito-cms-core'
import { resolveConfig } from '../src/utils/config.js'

const FAKE_CWD = '/fake/project'

describe('runValidate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Re-establish defaults after reset
    vi.mocked(resolveConfig).mockResolvedValue({
      schema: { dir: '/fake/schemas' },
      db: {},
      storage: {},
      server: {},
      api: { prefix: '/api', media: undefined },
      admin: { prefix: '/admin' },
    } as never)
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [] })
    vi.mocked(loadSchemaFile).mockReturnValue({ ok: true, value: '{}' })
    vi.mocked(parseRoles).mockReturnValue({ ok: true, value: [] } as never)
    vi.mocked(parseRoutes).mockReturnValue({ ok: true, value: [] } as never)
    vi.mocked(buildSchemaRegistry).mockReturnValue({} as never)
    vi.mocked(validateCrossReferences).mockReturnValue([])
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('exits 0 and prints success when all files are valid', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    // No errors — all mocks return success by default
    await runValidate({}, { cwd: FAKE_CWD })

    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('No errors found'))
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('exits 1 and lists the error when a schema file fails to parse', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [
      { raw: '{}', schema_type: 'content-type' as const, path: 'schemas/blog-post.json' },
    ]})
    vi.mocked(parseSchema).mockReturnValueOnce({
      ok: false,
      errors: [{ file: 'schemas/blog-post.json', message: 'unknown field type "richtext"' }],
    } as never)

    await expect(runValidate({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('blog-post.json'))
    exitSpy.mockRestore()
  })

  it('exits 1 when roles.json fails to parse', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(parseRoles).mockReturnValueOnce({
      ok: false,
      errors: [{ file: 'roles.json', message: 'duplicate hierarchy_level' }],
    } as never)

    await expect(runValidate({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('roles.json'))
    exitSpy.mockRestore()
  })

  it('exits 1 when routes.json fails to parse', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(parseRoutes).mockReturnValueOnce({
      ok: false,
      errors: [{ file: 'routes.json', message: 'references unknown content type "news_article"' }],
    } as never)

    await expect(runValidate({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('routes.json'))
    exitSpy.mockRestore()
  })

  it('collects and lists all errors from multiple files before exiting', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [
      { raw: '{}', schema_type: 'content-type' as const, path: 'schemas/blog-post.json' },
      { raw: '{}', schema_type: 'content-type' as const, path: 'schemas/article.json' },
    ]})
    vi.mocked(parseSchema)
      .mockReturnValueOnce({ ok: false, errors: [{ file: 'schemas/blog-post.json', message: 'bad field' }] } as never)
      .mockReturnValueOnce({ ok: false, errors: [{ file: 'schemas/article.json', message: 'bad ref' }] } as never)
    vi.mocked(parseRoles).mockReturnValueOnce({
      ok: false,
      errors: [{ file: 'roles.json', message: 'invalid role' }],
    } as never)

    await expect(runValidate({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    // All three files should appear in stderr output
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('blog-post.json'))
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('article.json'))
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('roles.json'))
    exitSpy.mockRestore()
  })
})
