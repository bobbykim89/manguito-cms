import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProgrammaticResolvers } from '../programmatic-loader.js'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'prog-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

// A resolver module written as .mjs so it can be imported natively in tests.
function resolverModule(schema: string, field: string): string {
  return `export default { __manguito_programmatic: true, schema: ${JSON.stringify(schema)}, field: ${JSON.stringify(field)}, resolve: () => 'v' }\n`
}

describe('loadProgrammaticResolvers', () => {
  it('returns an empty map when the directory does not exist', async () => {
    const map = await loadProgrammaticResolvers(cwd, './src/programmatic')
    expect(map.size).toBe(0)
  })

  it('loads all resolver modules under the directory (recursive)', async () => {
    const dir = join(cwd, 'src', 'programmatic')
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(join(dir, 'a.mjs'), resolverModule('content--x', 'a'))
    await writeFile(join(dir, 'nested', 'b.mjs'), resolverModule('content--x', 'b'))
    const map = await loadProgrammaticResolvers(cwd, './src/programmatic')
    expect(map.size).toBe(2)
    expect(map.has('content--x::a')).toBe(true)
    expect(map.has('content--x::b')).toBe(true)
  })

  it('throws on a duplicate schema::field binding', async () => {
    const dir = join(cwd, 'src', 'programmatic')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'a.mjs'), resolverModule('content--x', 'dup'))
    await writeFile(join(dir, 'b.mjs'), resolverModule('content--x', 'dup'))
    await expect(loadProgrammaticResolvers(cwd, './src/programmatic')).rejects.toThrow(/dup/)
  })

  it('throws when a module default export is not a programmatic field', async () => {
    const dir = join(cwd, 'src', 'programmatic')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bad.mjs'), 'export default { not: "a resolver" }\n')
    await expect(loadProgrammaticResolvers(cwd, './src/programmatic')).rejects.toThrow(/programmaticField/)
  })
})
