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

describe('AMBIGUOUS_RENAME — dedup and label-keyed drops (fix round 1)', () => {
  // Reproduction: a field labelled `blog_title` at v1 is renamed to `title`
  // by a rename tagged `after: 'v1'`, so live snapshot v2 exposes it under
  // label `title` while its fold-derived column is still `blog_title`. It is
  // then removed entirely from current, and a same-typed field appears.
  //
  // Two live snapshots (v1, v2) both expose the SAME folded column under two
  // different labels. Before this fix: the check looped per (snapshot,
  // oldField), so this one ambiguity produced one message per snapshot —
  // several naming the stale v1 label `blog_title` rather than the label an
  // author actually sees today (`title`, from the more recent v2) — and drops
  // were matched against the fold-derived COLUMN rather than the LABEL the
  // design spec requires (2026-08-30-version-model-core-design.md:97),
  // making the tool's own suggested fix ineffective.
  function buildInput(pending: typeof EMPTY_PENDING) {
    return {
      snapshots: [
        { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]) },
        { version: 'v2', registry: makeRegistry([makeContentType('content--post', [{ name: 'title' }])]) },
      ],
      current: makeRegistry([makeContentType('content--post', [{ name: 'headline' }])]),
      currentVersion: 'v3',
      live: ['v1', 'v2', 'v3'],
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending,
    }
  }

  it('fires exactly once, naming the most-recent live label', () => {
    const errors = validateVersionModel(buildInput(EMPTY_PENDING))
    const ambiguous = errors.filter((e) => e.code === 'AMBIGUOUS_RENAME')

    expect(ambiguous).toHaveLength(1)
    expect(ambiguous[0]!.message).toContain('title')
    expect(ambiguous[0]!.message).not.toContain('blog_title')
  })

  it('is suppressed by writing the drops entry exactly as the message spells it', () => {
    const before = validateVersionModel(buildInput(EMPTY_PENDING))
    const ambiguous = before.find((e) => e.code === 'AMBIGUOUS_RENAME')!

    // Extract the suggested drops literal straight from the message text,
    // rather than hardcoding a label chosen independently of it — that
    // independence is exactly what let the message and the matcher drift
    // apart in the first place.
    const match = ambiguous.message.match(/"([^"]+)"\s+\(under "drops"\)/)
    expect(match).not.toBeNull()
    const suggestedDrop = match![1]!

    const after = validateVersionModel(buildInput({ renames: [], drops: [suggestedDrop!], fallbacks: {} }))
    expect(after).toEqual([])
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
