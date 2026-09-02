import { describe, it, expect } from 'vitest'
import { buildProjections } from '../projections'
import { makeContentType, makeTaxonomyType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

describe('buildProjections', () => {
  it('gives current an identity projection', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])])
    const p = buildProjections({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
      { column_name: 'b', exposed_as: 'b' },
    ])
  })

  it('gives current an identity projection for a taxonomy type', () => {
    const current = makeRegistry([makeTaxonomyType('taxonomy--tag', [{ name: 'a' }, { name: 'b' }])])
    const p = buildProjections({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['taxonomy--tag']!.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
      { column_name: 'b', exposed_as: 'b' },
    ])
  })

  it('exposes a renamed field under its OLD label in the old version', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const history = {
      renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ])
    expect(p['v2']!.types['content--post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'title' },
    ])
  })

  it('attaches a fallback to the right column, absent from current once dropped', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: { renames: [], drops: [], fallbacks: { 'content--post.gone': '' } },
      pending: EMPTY_PENDING,
    })
    const gone = p['v1']!.types['content--post']!.fields.find((f) => f.column_name === 'gone')!
    expect(gone.fallback).toBe('')

    // A dropped column must not resurface in current's own projection — this
    // holds today because `current` (the raw parsed registry, not the union)
    // is what's iterated for the current version, so a dropped field is never
    // yielded. A convenience refactor that swapped in the union registry here
    // would silently reintroduce it.
    const goneInCurrent = p['v2']!.types['content--post']!.fields.find((f) => f.column_name === 'gone')
    expect(goneInCurrent).toBeUndefined()
  })

  // Final-review I4. Only history.fallbacks was read, so a fallback declared
  // in pending.json — beside the `drops` entry that made the field vanish, the
  // pairing the spec's own pending.json example shows and CONTEXT.md already
  // documents — was silently inert until the next cut, which is precisely the
  // window in which new rows are writing null into a column v1 still serves.
  it('honours a fallback declared in pending, not only in history', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: { renames: [], drops: ['content--post.gone'], fallbacks: { 'content--post.gone': 'FB' } },
    })
    const gone = p['v1']!.types['content--post']!.fields.find((f) => f.column_name === 'gone')!
    expect(gone).toEqual({ column_name: 'gone', exposed_as: 'gone', fallback: 'FB' })
  })

  it('lets a pending fallback win over a history fallback for the same column', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: { renames: [], drops: [], fallbacks: { 'content--post.gone': 'OLD' } },
      pending: { renames: [], drops: [], fallbacks: { 'content--post.gone': 'NEW' } },
    })
    const gone = p['v1']!.types['content--post']!.fields.find((f) => f.column_name === 'gone')!
    expect(gone.fallback).toBe('NEW')
  })

  it('keys a fallback by column even when a live version exposes it under a different label', () => {
    // The rename is tagged "after: v0" — before v1 itself — so v1's OWN
    // labels already reflect it: v1's schema shows "summary", not the
    // original "blog_desc". That makes column_name ('blog_desc') diverge
    // from exposed_as ('summary') within v1's own projection, which is what
    // lets this test tell column-keying apart from label-keying: under
    // label-keying, the lookup key would be 'content--post.summary', which
    // does not match the fallback's key 'content--post.blog_desc', so the
    // fallback would silently go missing.
    //
    // (A rename tagged "after: v1" does not shape v1's OWN labels — per
    // fold.ts, "after: vJ" only shapes labels for versions strictly newer
    // than vJ — so a v1-tagged rename leaves column_name === exposed_as at
    // v1 and does not discriminate the two keying schemes. Confirmed by
    // trial: patching the implementation to key by label left that
    // construction passing unchanged.)
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'summary' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const history = {
      renames: [{ after: 'v0', type: 'content--post', from: 'blog_desc', to: 'summary' }],
      drops: [], fallbacks: { 'content--post.blog_desc': 'N/A' },
    }
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history, pending: EMPTY_PENDING,
    })
    const field = p['v1']!.types['content--post']!.fields.find((f) => f.column_name === 'blog_desc')!
    expect(field).toEqual({ column_name: 'blog_desc', exposed_as: 'summary', fallback: 'N/A' })
  })

  it('omits a type a version does not define', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--old', [{ name: 'a' }])]),
    }]
    const current = makeRegistry([makeContentType('content--new', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--new']).toBeUndefined()
    expect(p['v2']!.types['content--old']).toBeUndefined()
  })
})
