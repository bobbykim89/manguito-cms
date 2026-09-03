import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateVersionModel } from '../codegen/version-model.js'
import type { VersionModel } from '@bobbykim/manguito-cms-core'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-vm-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

/** A model whose `union` is a distinctive object, so its absence is checkable. */
function model(projections: VersionModel['projections']): VersionModel {
  return {
    current: 'v2',
    live: ['v1', 'v2'],
    union: { UNION_SENTINEL: true } as never,
    projections,
  }
}

const SIMPLE = { v1: { version: 'v1', types: { 'content--post': { fields: [
  { column_name: 'blog_title', exposed_as: 'blog_title' },
] } } } }

describe('generateVersionModel', () => {
  it('writes a module exporting the reduced model', async () => {
    await generateVersionModel(model(SIMPLE), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')

    expect(src).toContain('export const versionModel')
    expect(src).toContain('"current": "v2"')
    expect(src).toContain('"v1"')
    expect(src).toContain('projections')
  })

  it('omits the union entirely', async () => {
    // union IS the current registry, which is baked separately and which
    // createCmsApp already receives. Including it would duplicate the whole
    // registry in the generated bundle — the sentinel proves it is dropped
    // rather than merely absent from this small fixture.
    await generateVersionModel(model(SIMPLE), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')

    expect(src).not.toContain('UNION_SENTINEL')
    expect(src).not.toContain('"union"')
  })

  it('round-trips every fallback type, including falsy ones', async () => {
    // A fallback is `unknown`. '' , 0 and false must survive serialization as
    // themselves — if any became null, the projector would substitute over a
    // legitimate stored value at runtime.
    const withFallbacks = { v1: { version: 'v1', types: { 'content--post': { fields: [
      { column_name: 'a', exposed_as: 'a', fallback: '' },
      { column_name: 'b', exposed_as: 'b', fallback: 0 },
      { column_name: 'c', exposed_as: 'c', fallback: false },
      { column_name: 'd', exposed_as: 'd', fallback: null },
    ] } } } }
    await generateVersionModel(model(withFallbacks as never), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')

    // Parse back the object literal the codegen embedded and compare exactly.
    const json = src.slice(src.indexOf('{', src.indexOf('export const versionModel')))
    const parsed = JSON.parse(json.slice(0, json.lastIndexOf('}') + 1))
    const fields = parsed.projections.v1.types['content--post'].fields
    expect(fields.map((f: { fallback: unknown }) => f.fallback)).toEqual(['', 0, false, null])
  })

  it('emits a generated-file marker so nobody hand-edits it', async () => {
    await generateVersionModel(model(SIMPLE), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')
    expect(src).toMatch(/GENERATED/)
  })
})
