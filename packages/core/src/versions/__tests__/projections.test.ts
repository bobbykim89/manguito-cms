import { describe, it, expect } from 'vitest'
import { buildProjections } from '../projections'
import { makeContentType, makeTaxonomyType, makeRegistry } from './fixtures'

describe('buildProjections — a renamed field', () => {
  it('exposes the old name in the old version and the new name in current, over one column', () => {
    // The redesign's central case. v1's own schema file says `blog_title`;
    // current says `title` with column `blog_title`. One column, two names,
    // and nothing folded.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([makeContentType('content--blog_post', [{ name: 'blog_title' }])]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [{ name: 'title', column: 'blog_title' }]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ])
    expect(projections['v2']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'title' },
    ])
  })
})

describe('buildProjections — a tombstone', () => {
  it('excludes the tombstone from current while the older version still exposes it', () => {
    const v1 = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields.map((f) => f.exposed_as))
      .toEqual(['title', 'blog_desc'])
    // Current retains the column but does not serve it.
    expect(projections['v2']!.types['content--blog_post']!.fields.map((f) => f.exposed_as))
      .toEqual(['title'])
  })

  it('attaches a fallback declared on current to the OLDER version that still exposes the column', () => {
    // The subtlety worth its own test. The fallback lives on current's
    // tombstone, because that is what knows the column stopped being written.
    // The version that NEEDS it is v1 — the one still serving the column to
    // rows created since. Reading the fallback off each projection's own
    // registry would leave it permanently inert: v1's snapshot predates the
    // tombstone and has no fallback on it, and current never exposes the
    // column at all.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true, fallback: '' },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    const v1Desc = projections['v1']!.types['content--blog_post']!.fields
      .find((f) => f.column_name === 'blog_desc')
    expect(v1Desc).toEqual({ column_name: 'blog_desc', exposed_as: 'blog_desc', fallback: '' })
  })

  it('keys the fallback by column, so a field renamed and then removed still matches', () => {
    // v1 exposes column `description` as `description`. Current's tombstone is
    // named `blog_desc` but declares column `description`. Keying the fallback
    // by NAME would miss it; keying by column matches.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([makeContentType('content--blog_post', [{ name: 'description', type: 'text/rich' }])]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'blog_desc', type: 'text/rich', column: 'description', removed: true, fallback: 'gone' },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'description', exposed_as: 'description', fallback: 'gone' },
    ])
  })
})

describe('buildProjections — shape', () => {
  it('omits fallback entirely when none is declared', () => {
    // Not `fallback: undefined`. The zero-config case must deep-equal cleanly
    // in tests and over the wire.
    const current = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])])
    const projections = buildProjections({ current, currentVersion: 'v1', snapshots: [] })
    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'title', exposed_as: 'title' },
    ])
  })

  it('projects taxonomy types alongside content types', () => {
    const current = makeRegistry([
      makeContentType('content--blog_post', [{ name: 'title' }]),
      makeTaxonomyType('taxonomy--tag', [{ name: 'tag_name' }]),
    ])
    const projections = buildProjections({ current, currentVersion: 'v1', snapshots: [] })
    expect(Object.keys(projections['v1']!.types).sort()).toEqual(['content--blog_post', 'taxonomy--tag'])
  })

  it('excludes fields with no storage column', () => {
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'cards', type: 'paragraph', ref: 'paragraph--photo_card', rel: 'one-to-many' },
      ]),
    ])
    const projections = buildProjections({ current, currentVersion: 'v1', snapshots: [] })
    expect(projections['v1']!.types['content--blog_post']!.fields.map((f) => f.exposed_as)).toEqual(['title'])
  })
})
