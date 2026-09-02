import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeTaxonomyType, makeRegistry } from './fixtures'

describe('computeVersionModel', () => {
  it('derives v1 and an identity model when there are no snapshots', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = computeVersionModel({ current, snapshots: [] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v1')
    expect(r.value.live).toEqual(['v1'])
    expect(r.value.union).toBe(current)
    expect(r.value.projections['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
    ])
  })

  it('derives the current version as one past the highest snapshot', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]) },
      { version: 'v2', registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = computeVersionModel({ current, snapshots })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v3')
    expect(r.value.live).toEqual(['v1', 'v2', 'v3'])
  })

  it('derives current from the HIGHEST snapshot number, not the snapshot count, when snapshots are non-contiguous', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]) },
      { version: 'v3', registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = computeVersionModel({ current, snapshots })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v4')
    expect(r.value.live).toEqual(['v1', 'v3', 'v4'])
  })

  // Final-review M2: `live` is documented oldest-first, and
  // checkUnionCompleteness's currentVersion skip relies on that order being
  // stable, so it must come from the version number and not from the
  // caller's array order.
  it('orders `live` by version number regardless of the snapshots’ array order', () => {
    const post = () => makeContentType('content--post', [{ name: 'a' }])
    const snapshots = [
      { version: 'v2', registry: makeRegistry([post()]) },
      { version: 'v1', registry: makeRegistry([post()]) },
    ]
    const r = computeVersionModel({ current: makeRegistry([post()]), snapshots })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.live).toEqual(['v1', 'v2', 'v3'])
  })

  it('does not give one version two positions in `live`', () => {
    const post = () => makeContentType('content--post', [{ name: 'a' }])
    const snapshots = [
      { version: 'v1', registry: makeRegistry([post()]) },
      { version: 'v1', registry: makeRegistry([post()]) },
    ]
    const r = computeVersionModel({ current: makeRegistry([post()]), snapshots })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.live).toEqual(['v1', 'v2'])
  })

  // Task 6: a forgotten column override leaves v1's column out of the union
  // entirely, so the Result the caller sees is a failure — the completeness
  // check, wired end to end through computeVersionModel rather than called
  // directly.
  it('returns collected errors rather than a value when validation fails', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const r = computeVersionModel({ current, snapshots })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_COLUMN_MISSING')
  })
})

describe('computeVersionModel — the union is current', () => {
  it('returns current itself as the union, by reference', () => {
    const current = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])])
    const result = computeVersionModel({ current, snapshots: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Not merely deep-equal: retention is stated, so there is no merge step
    // that could produce a copy. 2b consumes this as an ordinary SchemaRegistry.
    expect(result.value.union).toBe(current)
  })

  it('keeps a tombstone in the union as a nullable column', () => {
    // The tombstone is what makes "the union is current" safe: the retained
    // column is IN current, so db codegen still emits it.
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snap = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ]),
    }
    const result = computeVersionModel({ current, snapshots: [snap] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const fields = result.value.union.content_types['content--blog_post']!.fields
    const retained = fields.find((f) => f.db_column?.column_name === 'blog_desc')
    expect(retained).toBeDefined()
    expect(retained!.db_column!.nullable).toBe(true)
    expect(retained!.removed).toBe(true)
  })

  it('leaves a non-tombstone field\'s own nullability alone', () => {
    // The falsifiable half of the test above: forcing nullable must apply to
    // tombstones only. A blanket `nullable: true` over the union would pass
    // that test and make every required column optional.
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title', required: true },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snap = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title', required: true },
          { name: 'blog_desc', type: 'text/rich' },
        ]),
      ]),
    }
    const result = computeVersionModel({ current, snapshots: [snap] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const title = result.value.union.content_types['content--blog_post']!.fields
      .find((f) => f.name === 'title')!
    expect(title.db_column!.nullable).toBe(false)
    expect(title.required).toBe(true)
  })

  // Triage of union.test.ts's "retains and relaxes a dropped taxonomy column
  // too": that test exercised taxonomy_types specifically, which the tests
  // above never touch (they only build content types). The parser is
  // documented to treat both maps identically, but that is exactly the kind
  // of claim a test earns rather than assumes — so taxonomy gets its own
  // tombstone case rather than trusting content coverage to generalize.
  it('keeps a tombstone in a taxonomy type as a nullable column too', () => {
    const current = makeRegistry([
      makeTaxonomyType('taxonomy--tag', [
        { name: 'a' },
        { name: 'gone', removed: true },
      ]),
    ])
    const snap = {
      version: 'v1',
      registry: makeRegistry([
        makeTaxonomyType('taxonomy--tag', [{ name: 'a' }, { name: 'gone' }]),
      ]),
    }
    const result = computeVersionModel({ current, snapshots: [snap] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const fields = result.value.union.taxonomy_types['taxonomy--tag']!.fields
    const retained = fields.find((f) => f.db_column?.column_name === 'gone')
    expect(retained).toBeDefined()
    expect(retained!.db_column!.nullable).toBe(true)
    expect(retained!.removed).toBe(true)
  })
})
