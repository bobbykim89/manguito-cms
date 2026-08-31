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
