import { describe, it, expect } from 'vitest'
import { validateVersionModel, validateModelStructure } from '../validate'
import { buildUnionRegistry } from '../union'
import { buildProjections } from '../projections'
import {
  makeContentType,
  makeParagraphType,
  makeTaxonomyType,
  makeRegistry,
  EMPTY_HISTORY,
  EMPTY_PENDING,
} from './fixtures'

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

// Final-review I3. Retention covers columns inside content and taxonomy types
// that CURRENT still defines — nothing else. Rather than quietly omitting live
// storage from the union (and, for a deleted type, disagreeing with that same
// version's projection), the boundary is refused out loud. Extending retention
// to paragraph tables is a 2b/2e decision, not a fix-wave improvisation.
describe('VERSION_RETENTION_UNSUPPORTED', () => {
  it('fires when a live version exposes a content type current deleted', () => {
    const errors = validateVersionModel({
      snapshots: [{
        version: 'v1',
        registry: makeRegistry([makeContentType('content--old', [{ name: 'a' }])]),
      }],
      current: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]),
      currentVersion: 'v2',
      live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    })
    const retention = errors.filter((e) => e.code === 'VERSION_RETENTION_UNSUPPORTED')
    expect(retention).toHaveLength(1)
    expect(retention[0]!.message).toContain('content--old')
    expect(retention[0]!.message).toContain('retire v1')
  })

  it('fires when a live version exposes a taxonomy type current deleted', () => {
    const errors = validateVersionModel({
      snapshots: [{
        version: 'v1',
        registry: makeRegistry([makeTaxonomyType('taxonomy--old', [{ name: 'a' }])]),
      }],
      current: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]),
      currentVersion: 'v2',
      live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('VERSION_RETENTION_UNSUPPORTED')
  })

  it('fires when a live version’s paragraph type loses a column in current', () => {
    const errors = validateVersionModel({
      snapshots: [{
        version: 'v1',
        registry: makeRegistry([makeParagraphType('paragraph--card', [{ name: 'a' }, { name: 'gone' }])]),
      }],
      current: makeRegistry([makeParagraphType('paragraph--card', [{ name: 'a' }])]),
      currentVersion: 'v2',
      live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    })
    const retention = errors.filter((e) => e.code === 'VERSION_RETENTION_UNSUPPORTED')
    expect(retention).toHaveLength(1)
    expect(retention[0]!.message).toContain('gone')
    expect(retention[0]!.message).toContain('paragraph--card')
  })

  it('fires when a live version’s paragraph type is gone from current entirely', () => {
    const errors = validateVersionModel({
      snapshots: [{
        version: 'v1',
        registry: makeRegistry([makeParagraphType('paragraph--card', [{ name: 'a' }])]),
      }],
      current: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]),
      currentVersion: 'v2',
      live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('VERSION_RETENTION_UNSUPPORTED')
  })

  it('does NOT fire for an unchanged paragraph type, or for a retained content column', () => {
    const errors = validateVersionModel({
      snapshots: [{
        version: 'v1',
        registry: makeRegistry([
          makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }]),
          makeParagraphType('paragraph--card', [{ name: 'a' }]),
        ]),
      }],
      current: makeRegistry([
        makeContentType('content--post', [{ name: 'a' }]),
        makeParagraphType('paragraph--card', [{ name: 'a' }]),
      ]),
      currentVersion: 'v2',
      live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire when a paragraph type GAINS a column in current', () => {
    const errors = validateVersionModel({
      snapshots: [{
        version: 'v1',
        registry: makeRegistry([makeParagraphType('paragraph--card', [{ name: 'a' }])]),
      }],
      current: makeRegistry([makeParagraphType('paragraph--card', [{ name: 'a' }, { name: 'b' }])]),
      currentVersion: 'v2',
      live: ['v1', 'v2'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })
})

// Final-review C1.3. A structural invariant on the BUILT model, which nothing
// checked before: it is how the pre-windowing shift bug shipped a union with
// two fields on one column, and a projection serving one column under two
// labels, while reporting ok: true.
describe('VERSION_MODEL_INCONSISTENT', () => {
  // A stale pending entry: current still carries BOTH labels, and the rename
  // maps one onto the other, so both fold to the same column. Nothing about
  // the entry is malformed — each endpoint is a real label, the window has no
  // from/to overlap and no repeated `to` — so only the post-construction
  // check can catch it.
  function staleRenameInput() {
    const current = makeRegistry([
      makeContentType('content--post', [{ name: 'headline' }, { name: 'title' }]),
    ])
    return {
      current,
      currentVersion: 'v1',
      snapshots: [],
      live: ['v1'],
      history: EMPTY_HISTORY,
      pending: {
        renames: [{ type: 'content--post', from: 'title', to: 'headline' }],
        drops: [], fallbacks: {},
      },
    }
  }

  it('reports a union type with two fields on one column', () => {
    const input = staleRenameInput()
    const errors = validateModelStructure({
      union: buildUnionRegistry(input),
      projections: {},
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('VERSION_MODEL_INCONSISTENT')
    expect(errors[0]!.message).toContain('two fields backed by column "title"')
  })

  it('reports a projection exposing one column under two labels', () => {
    const input = staleRenameInput()
    const errors = validateModelStructure({
      union: makeRegistry([makeContentType('content--post', [{ name: 'title' }])]),
      projections: buildProjections(input),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('VERSION_MODEL_INCONSISTENT')
    expect(errors[0]!.message).toContain('two labels')
  })

  it('passes a well-formed model', () => {
    const input = {
      current: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])]),
      currentVersion: 'v1',
      snapshots: [],
      live: ['v1'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    }
    expect(
      validateModelStructure({ union: buildUnionRegistry(input), projections: buildProjections(input) })
    ).toEqual([])
  })

  it('passes a union whose retained column merely duplicates another type’s column name', () => {
    // Same column name on two different types is ordinary — the invariant is
    // per type, not global.
    const input = {
      current: makeRegistry([
        makeContentType('content--post', [{ name: 'a' }]),
        makeContentType('content--page', [{ name: 'a' }]),
      ]),
      currentVersion: 'v1',
      snapshots: [],
      live: ['v1'],
      history: EMPTY_HISTORY,
      pending: EMPTY_PENDING,
    }
    expect(
      validateModelStructure({ union: buildUnionRegistry(input), projections: buildProjections(input) })
    ).toEqual([])
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
