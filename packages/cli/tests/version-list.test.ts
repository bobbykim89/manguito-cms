import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { makeTempProject, run, type TempProject } from './support/temp-project.js'

let project: TempProject
let apiPrefix = '/api'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn(async () => ({
    schema: {
      base_path: project.schemas,
      folders: {
        content_types: 'content-types',
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
      },
    },
    api: { prefix: apiPrefix, media: undefined },
  })),
}))

import { registerVersion, runVersionCreate, runVersionList, runVersionRetire } from '../src/commands/version.js'

const neverPrompt = {
  confirm: async () => {
    throw new Error('prompted although --yes was given')
  },
} as never
const field = (name: string, extra: object = {}) => ({ name, label: name, type: 'text/plain', required: false, ...extra })
const create = () => run(() => runVersionCreate({ yes: true }, { cwd: project.root, prompt: neverPrompt }))
const list = () => run(() => runVersionList({}, { cwd: project.root }))

beforeEach(() => {
  apiPrefix = '/api'
  project = makeTempProject()
})
afterEach(() => {
  project.cleanup()
})

describe('version:list', () => {
  it('guides a project with no versions', async () => {
    project.writeType('content--blog_post', [field('title')])

    const result = await list()

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toContain('No versions created yet. Your working schema is v1, served at /api/v1 and /api.')
  })

  it('summarises how far each live version is behind current', async () => {
    // MUTATION: compare each snapshot with itself instead of with the working
    // schema. Every line then reads "identical to current".
    project.writeType('content--blog_post', [field('title'), field('body')])
    await create() // v1: title, body
    project.writeType('content--blog_post', [
      field('heading', { column: 'title' }),
      field('body', { removed: true }),
      field('summary'),
    ])
    await create() // v2: v1 with title renamed, body removed, summary added

    const result = await list()

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toContain('  v1  /api/v1  1 renamed, 1 removed, 1 added since')
    expect(result.stdout).toContain('  v2  /api/v2  identical to current')
    expect(result.stdout).toContain('  v3  /api/v3  current — also /api')
  })

  it('skips a retired version and still measures the others', async () => {
    // Review Focus #4. MUTATION: list every number from v1 to current instead
    // of the live set. A "v2" line then appears.
    project.writeType('content--blog_post', [field('title')])
    await create() // v1
    project.writeType('content--blog_post', [field('title'), field('a')])
    await create() // v2
    project.writeType('content--blog_post', [field('title'), field('a'), field('b')])
    await create() // v3
    await run(() => runVersionRetire('v2', { yes: true }, { cwd: project.root, prompt: neverPrompt }))

    const result = await list()

    expect(result.stdout).toContain('Live versions (3):')
    expect(result.stdout).toContain('  v1  /api/v1  2 added since')
    expect(result.stdout).not.toContain('v2')
    expect(result.stdout).toContain('  v3  /api/v3  identical to current')
    expect(result.stdout).toContain('  v4  /api/v4  current — also /api')
  })

  it('counts the fields of a type added after a version was created', async () => {
    // Review Focus #5. MUTATION: skip types whose status is 'added'. v1 then
    // reads "identical to current".
    project.writeType('content--blog_post', [field('title')])
    await create() // v1
    project.writeType('content--page', [field('heading'), field('body')])

    const result = await list()

    expect(result.stdout).toContain('  v1  /api/v1  2 added since')
  })

  it('uses the configured API prefix', async () => {
    // MUTATION: hard-code '/api' instead of ctx.apiPrefix.
    apiPrefix = '/content'
    project.writeType('content--blog_post', [field('title')])
    await create()

    const result = await list()

    expect(result.stdout).toContain('  v1  /content/v1  identical to current')
    expect(result.stdout).toContain('  v2  /content/v2  current — also /content')
  })

  it('exits with the model errors when the model is invalid', async () => {
    // Same preamble as diff/create/retire. MUTATION: catch the model error and
    // print the table anyway.
    project.writeType('content--blog_post', [
      field('title'),
      field('legacy', { column: 'legacy_col', removed: true }),
    ])

    const result = await list()

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('no live version exposes that column any more')
  })

  it('appears in help', () => {
    // MUTATION: leave version:list unregistered.
    const p = new Command()
    registerVersion(p)
    expect(p.helpInformation()).toContain('version:list')
  })
})
