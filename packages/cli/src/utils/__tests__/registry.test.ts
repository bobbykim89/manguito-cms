import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@bobbykim/manguito-cms-core', () => ({
  walkSchemaDirectory: vi.fn(),
  parseSchema: vi.fn(),
  parseRoles: vi.fn(),
  parseRoutes: vi.fn(),
  buildSchemaRegistry: vi.fn(),
  loadSchemaFile: vi.fn(),
}))

import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
} from '@bobbykim/manguito-cms-core'
import { parseProjectSchemas } from '../registry.js'

const CWD = '/proj'
const config = {
  schema: { base_path: 'schemas', folders: { content_types: 'content-types' } },
} as never

const file = { raw: '{}', schema_type: 'content-type' as const, path: 'schemas/post.json' }

describe('parseProjectSchemas', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(walkSchemaDirectory).mockReturnValue({ ok: true, value: [file] })
    vi.mocked(parseSchema).mockReturnValue({ ok: true, schema: { name: 'post' } } as never)
    vi.mocked(loadSchemaFile).mockReturnValue({ ok: true, value: '{}' })
    vi.mocked(parseRoles).mockReturnValue({ ok: true, value: { roles: [] } } as never)
    vi.mocked(parseRoutes).mockReturnValue({ ok: true, value: { routes: [] } } as never)
    vi.mocked(buildSchemaRegistry).mockReturnValue({ built: true } as never)
  })

  it('collects the schema-file error and the roles.json error together', () => {
    // MUTATION: return right after the schema-file errors. The roles.json
    // error is then missing, and the author fixes one problem per run.
    vi.mocked(parseSchema).mockReturnValue({
      ok: false,
      errors: [{ file: 'schemas/post.json', message: 'bad field' }],
    } as never)
    vi.mocked(loadSchemaFile).mockImplementation(((path: string) =>
      path.endsWith('roles.json')
        ? { ok: false, errors: [{ file: 'roles.json', message: 'cannot read' }] }
        : { ok: true, value: '{}' }) as never)

    const result = parseProjectSchemas(CWD, config)

    expect(result).toEqual({
      ok: false,
      errors: [
        { file: 'schemas/post.json', message: 'bad field' },
        { file: 'roles.json', message: 'cannot read' },
      ],
    })
    expect(buildSchemaRegistry).not.toHaveBeenCalled()
  })

  it('walks an absolute base_path', () => {
    // MUTATION: pass config.schema. Its relative base_path is then resolved
    // against the process cwd, not the project.
    parseProjectSchemas(CWD, config)

    expect(walkSchemaDirectory).toHaveBeenCalledWith({
      base_path: resolve(CWD, 'schemas'),
      folders: { content_types: 'content-types' },
    })
  })

  it('returns the registry buildSchemaRegistry builds', () => {
    // MUTATION: return { ok: true } without the built registry, or build it from the wrong inputs.
    const result = parseProjectSchemas(CWD, config)

    expect(result).toEqual({ ok: true, value: { built: true } })
    expect(buildSchemaRegistry).toHaveBeenCalledWith(
      [{ name: 'post' }],
      { routes: [] },
      { roles: [] },
    )
  })
})
