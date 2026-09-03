import { describe, it, expect } from 'vitest'
import { isAbsolute, join } from 'node:path'
import { resolveSchemaConfig } from '../utils/schema-config.js'

const FOLDERS = {
  content_types: 'content-types',
  paragraph_types: 'paragraph-types',
  taxonomy_types: 'taxonomy-types',
  enum_types: 'enum-types',
}

describe('resolveSchemaConfig', () => {
  it('makes a relative base_path absolute against cwd', () => {
    const out = resolveSchemaConfig('/projects/app', {
      schema: { base_path: './schemas', folders: FOLDERS },
    } as never)
    expect(isAbsolute(out.base_path)).toBe(true)
    expect(out.base_path).toBe(join('/projects/app', 'schemas'))
  })

  it('leaves an already-absolute base_path alone', () => {
    const out = resolveSchemaConfig('/projects/app', {
      schema: { base_path: '/elsewhere/schemas', folders: FOLDERS },
    } as never)
    expect(out.base_path).toBe('/elsewhere/schemas')
  })

  it('passes folders through unchanged, so an override survives', () => {
    const custom = { ...FOLDERS, content_types: 'ct' }
    const out = resolveSchemaConfig('/projects/app', {
      schema: { base_path: './schemas', folders: custom },
    } as never)
    expect(out.folders).toEqual(custom)
  })
})
