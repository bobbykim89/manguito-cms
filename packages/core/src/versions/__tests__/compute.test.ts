import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

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
