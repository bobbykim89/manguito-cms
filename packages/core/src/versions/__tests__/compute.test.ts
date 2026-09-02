import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeTaxonomyType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

describe('computeVersionModel', () => {
  it('derives v1 and an identity model when there are no snapshots', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = computeVersionModel({
      current, snapshots: [], history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
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
    const r = computeVersionModel({ current, snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING })
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
    const r = computeVersionModel({ current, snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v4')
    expect(r.value.live).toEqual(['v1', 'v3', 'v4'])
  })

  // Final-review M2: `live` is documented oldest-first, and
  // checkAmbiguousRenames reads position in it as recency, so the order must
  // come from the version number and not from the caller's array order.
  it('orders `live` by version number regardless of the snapshots’ array order', () => {
    const post = () => makeContentType('content--post', [{ name: 'a' }])
    const snapshots = [
      { version: 'v2', registry: makeRegistry([post()]) },
      { version: 'v1', registry: makeRegistry([post()]) },
    ]
    const r = computeVersionModel({
      current: makeRegistry([post()]), snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
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
    const r = computeVersionModel({
      current: makeRegistry([post()]), snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.live).toEqual(['v1', 'v2'])
  })

  // Final-review C1.3, wired end to end: a stale pending rename whose two
  // endpoints BOTH still exist in current is malformed in no way the input
  // checks can see — every label is real, the window has no from/to overlap —
  // yet it folds two fields onto one column. Only the post-construction
  // invariant catches it, and it must reach the caller as a failed Result.
  it('refuses a model whose fields collide on one column', () => {
    const current = makeRegistry([
      makeContentType('content--post', [{ name: 'headline' }, { name: 'title' }]),
    ])
    const r = computeVersionModel({
      current,
      snapshots: [],
      history: EMPTY_HISTORY,
      pending: {
        renames: [{ type: 'content--post', from: 'title', to: 'headline' }],
        drops: [], fallbacks: {},
      },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_MODEL_INCONSISTENT')
  })

  it('returns collected errors rather than a value when validation fails', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const r = computeVersionModel({ current, snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('AMBIGUOUS_RENAME')
  })

  // Final-review C1, end to end. Before the fix this returned ok: true with a
  // corrupt model in one declaration order — two fields carrying column
  // `subtitle`, `title` gone as a live column, and v2's projection serving one
  // column under two labels — and a correct model in the other. Now the fold
  // is order-independent AND the ambiguous declaration is refused, so neither
  // order can produce a plausible-looking wrong answer.
  it('refuses a field-name shift declared in one window, in either order', () => {
    const shift = [
      { type: 'content--post', from: 'title', to: 'headline' },
      { type: 'content--post', from: 'subtitle', to: 'title' },
    ]
    for (const renames of [shift, [...shift].reverse()]) {
      const snapshots = [{
        version: 'v1',
        registry: makeRegistry([makeContentType('content--post', [{ name: 'title' }, { name: 'subtitle' }])]),
      }]
      const current = makeRegistry([
        makeContentType('content--post', [{ name: 'headline' }, { name: 'title' }]),
      ])
      const r = computeVersionModel({
        current, snapshots,
        history: EMPTY_HISTORY,
        pending: { renames: [...renames], drops: [], fallbacks: {} },
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.map((e) => e.code)).toContain('RENAME_CHAIN_BROKEN')
    }
  })

  it('collects errors from BOTH chain validation and model validation', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const r = computeVersionModel({
      current, snapshots,
      history: {
        renames: [{ after: 'v1', type: 'content--ghost', from: 'a', to: 'b' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('RENAME_CHAIN_BROKEN')
    expect(codes).toContain('AMBIGUOUS_RENAME')
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
