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
  loadSchemaFile: vi.fn().mockReturnValue({ ok: true, value: '{}' }),
}))
vi.mock('../src/codegen/registry.js', () => ({ generateSchemaRegistry: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/codegen/routes.js', () => ({ generateRoutes: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/codegen/forms.js', () => ({ generateForms: vi.fn().mockResolvedValue(undefined) }))
vi.mock('vite', () => ({ build: vi.fn().mockResolvedValue(undefined) }))
vi.mock('tsup', () => ({ build: vi.fn().mockResolvedValue(undefined) }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, mkdirSync: vi.fn() }
})

import { runBuild } from '../src/commands/build.js'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
} from '@bobbykim/manguito-cms-core'
import { generateSchemaRegistry } from '../src/codegen/registry.js'
import { generateRoutes } from '../src/codegen/routes.js'
import { generateForms } from '../src/codegen/forms.js'
import { build as viteBuild } from 'vite'
import { build as tsupBuild } from 'tsup'
import { resolveConfig } from '../src/utils/config.js'

const FAKE_CWD = '/fake/project'

describe('runBuild', () => {
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
    vi.mocked(generateSchemaRegistry).mockResolvedValue(undefined)
    vi.mocked(generateRoutes).mockResolvedValue(undefined)
    vi.mocked(generateForms).mockResolvedValue(undefined)
    vi.mocked(viteBuild).mockResolvedValue({} as never)
    vi.mocked(tsupBuild).mockResolvedValue([] as never)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('calls all codegen steps in correct order when schemas are valid', async () => {
    const callOrder: string[] = []
    vi.mocked(generateSchemaRegistry).mockImplementation(async () => { callOrder.push('registry'); })
    vi.mocked(generateRoutes).mockImplementation(async () => { callOrder.push('routes'); })
    vi.mocked(generateForms).mockImplementation(async () => { callOrder.push('forms'); })
    vi.mocked(viteBuild).mockImplementation(async () => { callOrder.push('vite'); return {} as never })
    vi.mocked(tsupBuild).mockImplementation(async () => { callOrder.push('tsup'); return [] as never })

    await runBuild({}, { cwd: FAKE_CWD })

    expect(callOrder).toEqual(['registry', 'routes', 'forms', 'vite', 'tsup'])
  })

  it('lists all parse errors and calls process.exit(1) without running codegen', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [
      { raw: '{}', schema_type: 'content-type' as const, path: 'schemas/blog-post.json' },
      { raw: '{}', schema_type: 'content-type' as const, path: 'schemas/article.json' },
    ]})
    vi.mocked(parseSchema)
      .mockReturnValueOnce({ ok: false, errors: [{ file: 'schemas/blog-post.json', message: 'unknown field type "richtext"' }] } as never)
      .mockReturnValueOnce({ ok: false, errors: [{ file: 'schemas/article.json', message: 'references unknown content type' }] } as never)

    await expect(runBuild({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('blog-post.json'))
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('article.json'))
    expect(generateSchemaRegistry).not.toHaveBeenCalled()
    expect(viteBuild).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('calls process.exit(1) with error message when roles.json fails to parse', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(loadSchemaFile)
      .mockReturnValueOnce({ ok: true, value: '{}' }) // schema walk returns empty, loadSchemaFile called for roles first
    vi.mocked(parseRoles).mockReturnValueOnce({
      ok: false,
      errors: [{ file: 'roles.json', message: 'duplicate hierarchy_level' }],
    } as never)

    await expect(runBuild({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('roles.json'))
    exitSpy.mockRestore()
  })
})
