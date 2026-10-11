import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { makeTempProject, run, snapshot, type TempProject } from './support/temp-project.js'

let project: TempProject

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
    api: { prefix: '/api', media: undefined },
  })),
}))
// A prompt that fails the test instead of waiting on stdin forever: every
// run here passes --yes, so any prompt at all is a bug.
vi.mock('../src/utils/prompt.js', () => ({
  createPromptAdapter: () => ({
    confirm: async () => {
      throw new Error('prompted although --yes was given')
    },
  }),
}))

import { registerVersion, runVersionCreate, runVersionRetire, VERSION_CUT_DEPRECATION } from '../src/commands/version.js'

const neverPrompt = {
  confirm: async () => {
    throw new Error('prompted although --yes was given')
  },
} as never
const title = { name: 'title', label: 'Title', type: 'text/plain', required: false }
const create = () => runVersionCreate({ yes: true }, { cwd: project.root, prompt: neverPrompt })
const versionsDir = () => path.join(project.schemas, 'versions')

function program(): Command {
  const p = new Command()
  p.exitOverride()
  registerVersion(p)
  return p
}

beforeEach(() => {
  project = makeTempProject()
  project.writeType('content--blog_post', [title])
})
afterEach(() => {
  project.cleanup()
})

describe('version:create', () => {
  it('creates v1 on a new project and explains what that means, even with --yes', async () => {
    // MUTATION: print the first-run explanation only when prompting (inside
    // `if (options.yes !== true)`). It then disappears from this --yes run.
    const result = await run(create)

    expect(result.exitCode).toBeNull()
    expect(fs.existsSync(path.join(versionsDir(), 'v1', 'content-types', 'content--blog_post.json'))).toBe(true)
    expect(result.stdout).toContain('This creates v1 from your working schema. /api/v1 keeps serving it')
    expect(result.stdout).toContain('your working schema becomes v2, served at /api/v2 and /api.')
  })

  it('lists the working schema among the live versions after a create', async () => {
    // Today's cut omits the working schema ("v1 are live").
    // MUTATION: drop `next` from the live-after list.
    const result = await run(create)

    expect(result.stdout).toContain('After creating v1, these versions are live: v1 v2.')
    expect(result.stdout).toContain('Live: v1 v2.  Working schema is now v2.')
  })

  it('does not repeat the first-run explanation once a version exists', async () => {
    // MUTATION: drop the `from === null` condition on the explanation.
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, name: 'heading', column: 'title' }])

    const result = await run(create)

    expect(result.exitCode).toBeNull()
    expect(fs.existsSync(path.join(versionsDir(), 'v2'))).toBe(true)
    expect(result.stdout).not.toContain('This creates')
    expect(result.stdout).toContain('After creating v2, these versions are live: v1 v2 v3.')
  })

  it('refuses to freeze a schema reference error, and writes nothing', async () => {
    // MUTATION: drop validateCrossReferences from loadWorkingRegistry. The
    // snapshot is then written with the error, and snapshots are never
    // cross-validated again, so it would load forever (#65).
    fs.writeFileSync(
      path.join(project.schemas, 'taxonomy-types', 'taxonomy--tag.json'),
      JSON.stringify({ name: 'taxonomy--tag', label: 'Tag', type: 'taxonomy-type', fields: [] })
    )
    fs.writeFileSync(
      path.join(project.schemas, 'paragraph-types', 'paragraph--card.json'),
      JSON.stringify({
        name: 'paragraph--card', label: 'Card', type: 'paragraph-type',
        fields: [{ name: 'tags', label: 'Tags', type: 'reference', target: 'taxonomy--tag', rel: 'many-to-many', required: false }],
      })
    )

    const result = await run(create)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Field "tags" in "paragraph--card" is a many-to-many reference')
    expect(fs.existsSync(versionsDir())).toBe(false)
  })

  it('refuses a second create with nothing changed, and writes nothing', async () => {
    // Review Focus #3. MUTATION: remove the `change.identical` refusal.
    // versions/v2 then gets written.
    snapshot(project, 'v1')

    const result = await run(create)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('creating v2 would freeze an identical contract')
    expect(fs.existsSync(path.join(versionsDir(), 'v2'))).toBe(false)
  })
})

describe('version:cut (deprecated alias)', () => {
  it('warns on stderr, forwards --yes, and creates the version', async () => {
    // Review Focus #2: a dropped --yes would make the alias prompt, and the
    // prompt mock throws. MUTATION: call runVersionCreate({}, …) in the alias
    // action instead of passing its options through.
    const result = await run(() => program().parseAsync(['node', 'manguito', 'version:cut', '--yes']))

    expect(result.exitCode).toBeNull()
    expect(result.stderr).toBe(VERSION_CUT_DEPRECATION)
    expect(fs.existsSync(path.join(versionsDir(), 'v1'))).toBe(true)
  })

  it('writes exactly what version:create writes to stdout', async () => {
    // A script parsing the old command's stdout must not break.
    // MUTATION: write the deprecation line to stdout instead of stderr.
    const viaAlias = await run(() => program().parseAsync(['node', 'manguito', 'version:cut', '--yes']))
    const aliasRoot = project.root
    project.cleanup()
    project = makeTempProject()
    project.writeType('content--blog_post', [title])
    const viaCreate = await run(() => program().parseAsync(['node', 'manguito', 'version:create', '--yes']))

    const normalize = (s: string, root: string) => s.split(root).join('<root>')
    expect(normalize(viaAlias.stdout, aliasRoot)).toBe(normalize(viaCreate.stdout, project.root))
  })

  it('is hidden from help while version:create is listed', () => {
    // MUTATION: register version:cut without `{ hidden: true }`.
    const help = program().helpInformation()

    expect(help).toContain('version:create')
    expect(help).not.toContain('version:cut')
  })
})

describe('version:retire — renamed messages', () => {
  it('tells a project with no versions to run version:create', async () => {
    // MUTATION: keep the old "run `manguito version:cut` first" text.
    const result = await run(() =>
      runVersionRetire('v1', { yes: true }, { cwd: project.root, prompt: neverPrompt })
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No versions have been created yet — run `manguito version:create` first.')
  })
})
