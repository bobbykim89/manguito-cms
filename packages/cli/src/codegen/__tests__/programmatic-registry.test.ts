import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateProgrammaticRegistry } from '../programmatic-registry.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'reg-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('generateProgrammaticRegistry', () => {
  it('writes an empty map when there are no resolver files', async () => {
    await generateProgrammaticRegistry([], dir)
    const out = await readFile(join(dir, 'programmatic-registry.ts'), 'utf8')
    expect(out).toContain('export const programmaticResolvers')
    expect(out).toContain('new Map')
  })

  it('imports each file relative to the target dir and registers by schema::field', async () => {
    // Files live at <dir>/../src/programmatic/*.ts; import specifiers must be
    // relative to <dir> and use a .js extension.
    const fileA = join(dir, '..', 'src', 'programmatic', 'a.ts')
    await generateProgrammaticRegistry([fileA], dir)
    const out = await readFile(join(dir, 'programmatic-registry.ts'), 'utf8')
    expect(out).toContain("from '../src/programmatic/a.js'")
    // Registry keys are filled at runtime from each definition's schema/field:
    expect(out).toContain('def0.schema')
    expect(out).toContain('def0.field')
  })
})
