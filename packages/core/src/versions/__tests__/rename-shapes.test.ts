// packages/core/src/versions/__tests__/rename-shapes.test.ts
import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeRegistry } from './fixtures'

// These four shapes are why the version model was redesigned. Under the
// derived model, a chain (a→b, b→c) and a shift (a→b, b→c meaning something
// else entirely) had the SAME declared form, so neither could be folded
// safely and both were refused. Stated columns make each of them a set of
// independent facts with no ordering between them.

function model(currentFields: Parameters<typeof makeContentType>[1], v1Fields: Parameters<typeof makeContentType>[1]) {
  const result = computeVersionModel({
    current: makeRegistry([makeContentType('content--blog_post', currentFields)]),
    snapshots: [{ version: 'v1', registry: makeRegistry([makeContentType('content--blog_post', v1Fields)]) }],
  })
  if (!result.ok) throw new Error(`expected a valid model: ${JSON.stringify(result.errors, null, 2)}`)
  return result.value
}

/** [column, exposed_as] pairs for one version, sorted by column for a stable compare. */
function exposure(m: ReturnType<typeof model>, version: string): Array<[string, string]> {
  return m.projections[version]!.types['content--blog_post']!.fields
    .map((f): [string, string] => [f.column_name, f.exposed_as])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

describe('a shift', () => {
  it('resolves with no ordering dependence', () => {
    // v1:      title, subtitle
    // current: headline (column title), title (column subtitle)
    //
    // The name `title` means DIFFERENT columns in the two versions. The
    // derived model could not express this: `title → headline` and
    // `subtitle → title` applied in either order give different answers, and
    // sharing a tag made them simultaneous with no defined result.
    const m = model(
      [{ name: 'headline', column: 'title' }, { name: 'title', column: 'subtitle' }],
      [{ name: 'title' }, { name: 'subtitle' }]
    )
    expect(exposure(m, 'v1')).toEqual([['subtitle', 'subtitle'], ['title', 'title']])
    expect(exposure(m, 'v2')).toEqual([['subtitle', 'title'], ['title', 'headline']])
  })

  it('gives the same model when the fields are declared in the opposite order', () => {
    // The falsifiable half. Two orderings of the same declarations must give
    // identical models — that is what "no ordering dependence" means, and it
    // is the property the derived model lacked.
    const a = model(
      [{ name: 'headline', column: 'title' }, { name: 'title', column: 'subtitle' }],
      [{ name: 'title' }, { name: 'subtitle' }]
    )
    const b = model(
      [{ name: 'title', column: 'subtitle' }, { name: 'headline', column: 'title' }],
      [{ name: 'title' }, { name: 'subtitle' }]
    )
    expect(exposure(a, 'v1')).toEqual(exposure(b, 'v1'))
    expect(exposure(a, 'v2')).toEqual(exposure(b, 'v2'))
  })
})

describe('a swap', () => {
  it('resolves with no ordering dependence', () => {
    // v1:      a, b
    // current: b (column a), a (column b) — the two names exchanged.
    const m = model(
      [{ name: 'b', column: 'a' }, { name: 'a', column: 'b' }],
      [{ name: 'a' }, { name: 'b' }]
    )
    expect(exposure(m, 'v1')).toEqual([['a', 'a'], ['b', 'b']])
    expect(exposure(m, 'v2')).toEqual([['a', 'b'], ['b', 'a']])
  })
})

describe('a chain', () => {
  it('self-collapses — renaming twice leaves one declaration', () => {
    // a → b → c over two version cycles. There is no chain to fold: you edit
    // the same field's `name` each time, and its `column` never moves. What
    // the author ends up holding is `{ name: 'c', column: 'a' }`.
    const m = model(
      [{ name: 'c', column: 'a' }],
      [{ name: 'a' }]
    )
    expect(exposure(m, 'v1')).toEqual([['a', 'a']])
    expect(exposure(m, 'v2')).toEqual([['a', 'c']])
  })
})

describe('the zero-config case', () => {
  it('yields one live version, an identity projection, and a union equal to current', () => {
    const current = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }, { name: 'body', type: 'text/rich' }])])
    const result = computeVersionModel({ current, snapshots: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.current).toBe('v1')
    expect(result.value.live).toEqual(['v1'])
    expect(result.value.union).toBe(current)
    // Identity: every column exposed under its own name, no fallbacks.
    expect(result.value.projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'title', exposed_as: 'title' },
      { column_name: 'body', exposed_as: 'body' },
    ])
  })
})
