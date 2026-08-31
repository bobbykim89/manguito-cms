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

  it('corrects the column of a renamed field even when no other version is live', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots: [], live: ['v2'],
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    const cols = fieldsOf(union, 'content--post').map((f) => f.db_column?.column_name)
    expect(cols).toEqual(['blog_title'])
  })

  it('returns current by reference in the zero-config case', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(union).toBe(current)
  })

  it('a pending-only rename also defeats the fast path', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY,
      pending: { renames: [{ type: 'content--post', from: 'blog_title', to: 'title' }], drops: [], fallbacks: {} },
    })
    const cols = fieldsOf(union, 'content--post').map((f) => f.db_column?.column_name)
    expect(cols).toEqual(['blog_title'])
  })

  // Final-review I2. `SchemaRegistry.schemas` is documented as "the one source
  // of truth", so an ordinary registry cannot have it disagree with the typed
  // maps. Before the fix, spreading `...current` left
  // `union.schemas['content--post'] === current.schemas['content--post']` —
  // unfolded column, no retained field — while `union.content_types` had both.
  describe('registry consistency', () => {
    function build() {
      const snapshots = [{
        version: 'v1',
        registry: makeRegistry([
          makeContentType('content--post', [{ name: 'blog_title' }, { name: 'gone' }]),
          makeTaxonomyType('taxonomy--tag', [{ name: 'a' }, { name: 'tax_gone' }]),
        ]),
      }]
      const current = makeRegistry([
        makeContentType('content--post', [{ name: 'title' }]),
        makeTaxonomyType('taxonomy--tag', [{ name: 'a' }]),
      ])
      return buildUnionRegistry({
        current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
        history: {
          renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
          drops: [], fallbacks: {},
        },
        pending: EMPTY_PENDING,
      })
    }

    it('holds the same object in `schemas` as in `content_types`', () => {
      const union = build()
      expect(union.schemas['content--post']).toBe(union.content_types['content--post'])
    })

    it('holds the same object in `schemas` as in `taxonomy_types`', () => {
      const union = build()
      expect(union.schemas['taxonomy--tag']).toBe(union.taxonomy_types['taxonomy--tag'])
    })

    it('shows the folded column and the retained column through `schemas` too', () => {
      const union = build()
      const post = union.schemas['content--post']
      // `schemas` is typed as the ParsedSchema union, which includes enum types
      // (no `fields`) — narrow rather than cast.
      expect(post && 'fields' in post).toBe(true)
      if (!post || !('fields' in post)) return
      expect(post.fields.map((f) => f.db_column?.column_name)).toEqual(['blog_title', 'gone'])
    })

    it('swaps the rebuilt objects into `all_schemas` as well', () => {
      const union = build()
      const post = union.all_schemas.find((s) => s.name === 'content--post')
      expect(post).toBe(union.content_types['content--post'])
      expect(union.all_schemas).toHaveLength(2)
    })
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
