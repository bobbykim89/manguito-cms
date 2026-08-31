import { describe, it, expect } from 'vitest'
import { buildUnionRegistry } from '../union'
import { makeContentType, makeTaxonomyType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

function fieldsOf(reg: ReturnType<typeof makeRegistry>, type: string) {
  return reg.content_types[type]!.fields
}

describe('buildUnionRegistry', () => {
  it('equals current field-for-field when nothing was dropped', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(fieldsOf(union, 'content--post').map((f) => f.name)).toEqual(['a', 'b'])
  })

  it('retains a column an older version exposes that current dropped', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    const names = fieldsOf(union, 'content--post').map((f) => f.db_column?.column_name)
    expect(names).toContain('gone')
  })

  it('forces a retained column nullable even if it was required', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--post', [{ name: 'a' }, { name: 'gone', required: true }]),
      ]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    const retained = fieldsOf(union, 'content--post').find((f) => f.db_column?.column_name === 'gone')!
    expect(retained.db_column?.nullable).toBe(true)
  })

  it('leaves a field still in current with its own required', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a', required: true }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(fieldsOf(union, 'content--post')[0]!.db_column?.nullable).toBe(false)
  })

  it('does not duplicate a renamed field — one column, current’s label', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    const cols = fieldsOf(union, 'content--post').map((f) => f.db_column?.column_name)
    expect(cols).toEqual(['blog_title'])
  })

  it('retains and relaxes a dropped taxonomy column too', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([
        makeTaxonomyType('taxonomy--tag', [{ name: 'a' }, { name: 'gone', required: true }]),
      ]),
    }]
    const current = makeRegistry([makeTaxonomyType('taxonomy--tag', [{ name: 'a' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    const retained = union.taxonomy_types['taxonomy--tag']!.fields
      .find((f) => f.db_column?.column_name === 'gone')!
    expect(retained).toBeDefined()
    expect(retained.db_column?.nullable).toBe(true)
  })
})
