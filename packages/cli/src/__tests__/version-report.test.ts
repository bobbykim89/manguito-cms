import { describe, it, expect } from 'vitest'
import { formatSchemaChange, formatVersionList } from '../commands/version-report.js'
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
    // MUTATION: keep the old "nothing has been cut yet" wording.
    expect(out).toContain('nothing has been created yet')
  })
})

describe('formatVersionList', () => {
  const change = (fields: SchemaChange['types'][number]['fields']): SchemaChange => ({
    from: 'v1', to: 'v3', identical: fields.length === 0,
    types: [{ type: 'content--blog_post', status: 'present', fields }],
  })

  it('says plainly when no version has been created', () => {
    // MUTATION: render an empty table instead of the guidance.
    expect(formatVersionList({ prefix: '/api', current: 'v1', older: [] })).toBe(
      'No versions created yet. Your working schema is v1, served at /api/v1 and /api.\n' +
        'Run `manguito version:create` before making a breaking change.'
    )
  })

  it('lists live versions oldest first with drift, then current', () => {
    // MUTATION: count `tombstoned` under "added". The v1 line then reads
    // "1 renamed, 2 added since".
    const out = formatVersionList({
      prefix: '/api',
      current: 'v3',
      older: [
        {
          version: 'v1',
          change: change([
            { kind: 'renamed', column: 'title', from_name: 'title', to_name: 'heading' },
            { kind: 'tombstoned', column: 'body', name: 'body' },
            { kind: 'added', column: 'summary', name: 'summary', field_type: 'text/plain' },
          ]),
        },
        { version: 'v2', change: change([]) },
      ],
    })

    expect(out).toBe(
      [
        'Live versions (3):',
        '  v1  /api/v1  1 renamed, 1 removed, 1 added since',
        '  v2  /api/v2  identical to current',
        '  v3  /api/v3  current — also /api',
      ].join('\n')
    )
  })

  it('counts restored fields and omits zero counts', () => {
    // MUTATION: print every kind, zeros included.
    const out = formatVersionList({
      prefix: '/content',
      current: 'v2',
      older: [{ version: 'v1', change: change([{ kind: 'restored', column: 'x', name: 'x' }]) }],
    })

    expect(out).toContain('  v1  /content/v1  1 restored since')
    expect(out).toContain('  v2  /content/v2  current — also /content')
  })

  it('does not call a version identical when only a column-less type was added', () => {
    // describeSchemaChange reports identical: false for a new type even when
    // none of its fields has a column. MUTATION: return 'identical to current'
    // whenever no field counts are non-zero.
    const out = formatVersionList({
      prefix: '/api',
      current: 'v2',
      older: [{
        version: 'v1',
        change: { from: 'v1', to: 'v2', identical: false, types: [{ type: 'content--page', status: 'added', fields: [] }] },
      }],
    })

    expect(out).toContain('  v1  /api/v1  1 new type since')
  })
})
