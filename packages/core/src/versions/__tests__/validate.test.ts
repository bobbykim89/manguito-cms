import { describe, it, expect } from 'vitest'
import { validateVersionModel } from '../validate'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

function withV1(v1Fields: Parameters<typeof makeContentType>[1], currentFields: Parameters<typeof makeContentType>[1]) {
  return {
    snapshots: [{ version: 'v1', registry: makeRegistry([makeContentType('content--post', v1Fields)]) }],
    current: makeRegistry([makeContentType('content--post', currentFields)]),
    currentVersion: 'v2',
    live: ['v1', 'v2'],
  }
}

describe('AMBIGUOUS_RENAME', () => {
  it('fires on drop + same-typed add with no declaration', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('AMBIGUOUS_RENAME')
    expect(errors[0]!.message).toContain('blog_title')
    expect(errors[0]!.message).toContain('title')
  })

  it('does NOT fire when a rename declares it', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire when a drop confirms it', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: {
        renames: [], drops: [{ after: 'v1', field: 'content--post.blog_title' }], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire when the added field is a DIFFERENT type', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'count', type: 'integer' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire on a plain removal with nothing added', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'a' }, { name: 'gone' }], [{ name: 'a' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('accepts a drop declared in pending, not only history', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: EMPTY_HISTORY,
      pending: { renames: [], drops: ['content--post.blog_title'], fallbacks: {} },
    })
    expect(errors).toEqual([])
  })
})

describe('FIELD_TYPE_CHANGED_WHILE_LIVE', () => {
  it('fires when a column a live version exposes changed type', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'a', type: 'text/plain' }], [{ name: 'a', type: 'integer' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('FIELD_TYPE_CHANGED_WHILE_LIVE')
  })
})

describe('UNRENAMEABLE_FIELD_KIND', () => {
  // NOTE: the brief's literal fixture for this test names a rename ("cards" ->
  // "blocks") that appears in NEITHER snapshot's schema — no field named
  // "cards" or "blocks" exists anywhere. An implementation that flags a
  // rename whose endpoints resolve to no known field at all would make this
  // test pass without ever inspecting field kind (that is RENAME_CHAIN_BROKEN's
  // job, owned by fold.ts, not this check). To actually pin "fires when a
  // rename names a paragraph field", the fixture needs a REAL paragraph field
  // on one end of the rename — added here via the `ref`-bearing FieldSpec the
  // brief calls out fixtures.ts as already supporting.
  it('fires when a rename names a paragraph field', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [
        { name: 'a' },
        { name: 'cards', type: 'paragraph', ref: 'paragraph--card' },
      ])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [
      { name: 'a' },
      { name: 'blocks', type: 'paragraph', ref: 'paragraph--card' },
    ])])
    const errors = validateVersionModel({
      snapshots, current, currentVersion: 'v2', live: ['v1', 'v2'],
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'cards', to: 'blocks' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('UNRENAMEABLE_FIELD_KIND')
  })
})
