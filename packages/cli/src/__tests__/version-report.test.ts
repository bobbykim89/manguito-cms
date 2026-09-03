import { describe, it, expect } from 'vitest'
import { formatSchemaChange } from '../commands/version-report.js'
import type { SchemaChange } from '@bobbykim/manguito-cms-core'

const BASE: SchemaChange = { from: 'v2', to: 'v3', types: [], identical: true }

describe('formatSchemaChange', () => {
  it('names both versions in the header', () => {
    const out = formatSchemaChange({ ...BASE, types: [], identical: true })
    expect(out).toContain('v2')
    expect(out).toContain('v3')
  })

  it('says plainly when nothing changed', () => {
    const out = formatSchemaChange({ ...BASE, identical: true })
    expect(out.toLowerCase()).toContain('no column added, renamed, tombstoned or restored')
  })

  it('renders each of the four kinds with its own marker', () => {
    const out = formatSchemaChange({
      ...BASE,
      identical: false,
      types: [
        {
          type: 'content--blog_post',
          status: 'present',
          fields: [
            { kind: 'added', column: 'subtitle', name: 'subtitle', field_type: 'text/plain' },
            { kind: 'renamed', column: 'blog_title', from_name: 'blog_title', to_name: 'title' },
            { kind: 'tombstoned', column: 'blog_desc', name: 'blog_desc', fallback: '' },
            { kind: 'restored', column: 'old_flag', name: 'old_flag' },
          ],
        },
      ],
    })
    expect(out).toContain('content--blog_post')
    // Added shows the field type; a reader needs it to know what was frozen.
    expect(out).toMatch(/\+\s+subtitle.*text\/plain/)
    // Renamed shows the OLD name — the new name is already the row label.
    expect(out).toMatch(/~\s+title.*blog_title/)
    // Tombstoned says the column is retained, which is the consequence.
    expect(out).toMatch(/⊘\s+blog_desc/)
    expect(out).toContain('retained')
    expect(out).toMatch(/restored/i)
  })

  it('marks an added type as new', () => {
    const out = formatSchemaChange({
      ...BASE,
      identical: false,
      types: [{ type: 'taxonomy--tag', status: 'added', fields: [] }],
    })
    expect(out).toContain('taxonomy--tag')
    expect(out.toLowerCase()).toContain('new type')
  })

  it('shows a type with no changes without inventing field rows', () => {
    const out = formatSchemaChange({
      ...BASE,
      identical: false,
      types: [
        { type: 'content--blog_post', status: 'present', fields: [
          { kind: 'added', column: 'x', name: 'x', field_type: 'text/plain' },
        ] },
        { type: 'taxonomy--tag', status: 'present', fields: [] },
      ],
    })
    expect(out).toContain('taxonomy--tag')
    expect(out).toMatch(/taxonomy--tag[\s\S]*\(no changes\)/)
  })

  it('describes the first cut when from is null', () => {
    const out = formatSchemaChange({
      from: null, to: 'v1', identical: false,
      types: [{ type: 'content--blog_post', status: 'added', fields: [] }],
    })
    // Must not print "vs null".
    expect(out).not.toContain('null')
    expect(out).toContain('v1')
  })
})
