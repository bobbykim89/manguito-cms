import { describe, it, expect } from 'vitest'
import { columnOf, validateRenameChain } from '../fold'
import { EMPTY_HISTORY, EMPTY_PENDING, makeContentType, makeRegistry } from './fixtures'
import type { VersionHistory } from '../types'

const LIVE = ['v1', 'v2', 'v3']

describe('columnOf', () => {
  it('is identity when nothing was renamed', () => {
    expect(
      columnOf({
        label: 'blog_title', type: 'content--post', version: 'v3',
        live: LIVE, history: EMPTY_HISTORY, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  it('folds a single rename back to the original column', () => {
    const history: VersionHistory = {
      renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    // v2 sees 'title'; its column is the pre-rename label.
    expect(
      columnOf({
        label: 'title', type: 'content--post', version: 'v2',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  it('folds twice to the EARLIEST label, not the intermediate one', () => {
    const history: VersionHistory = {
      renames: [
        { after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' },
        { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
      ],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  it('does not apply a rename that came after the version being folded', () => {
    const history: VersionHistory = {
      renames: [{ after: 'v2', type: 'content--post', from: 'title', to: 'headline' }],
      drops: [], fallbacks: {},
    }
    // v2's own label is 'title' — the after-v2 rename must not touch it.
    expect(
      columnOf({
        label: 'title', type: 'content--post', version: 'v2',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('title')
  })

  it('includes pending renames when folding the current version', () => {
    const pending = {
      renames: [{ type: 'content--post', from: 'title', to: 'headline' }],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: LIVE, history: EMPTY_HISTORY, pending, current: 'v3',
      })
    ).toBe('title')
  })

  it('ignores renames belonging to a different type', () => {
    const history: VersionHistory = {
      renames: [{ after: 'v1', type: 'content--other', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'title', type: 'content--post', version: 'v3',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('title')
  })

  // THE regression test for the retirement bug. v1 is retired — its directory is
  // gone and it is no longer live — but history retains the rename that happened
  // after it, so the column must still resolve to the original.
  it('resolves through a RETIRED version’s rename', () => {
    const history: VersionHistory = {
      renames: [
        { after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' },
        { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
      ],
      drops: [], fallbacks: {},
    }
    // v1 has been retired: live is now v2 and v3 only.
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: ['v2', 'v3'], history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  // Pin: `live` must never be consulted. Same history, same target label and
  // version, only `live` differs (empty vs. fully populated) — the column
  // must come back identical either way.
  it('is unaffected by which versions are live', () => {
    const history: VersionHistory = {
      renames: [
        { after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' },
        { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
      ],
      drops: [], fallbacks: {},
    }
    const base = {
      label: 'headline', type: 'content--post', version: 'v3',
      history, pending: EMPTY_PENDING, current: 'v3',
    }
    expect(columnOf({ ...base, live: [] })).toBe(columnOf({ ...base, live: ['v1', 'v2', 'v3'] }))
  })

  // Final-review C1. Renames sharing one window (one `after` tag, or both in
  // pending.json) carry no order relative to one another, so the fold must
  // apply at most ONE substitution per window. Applying every match made the
  // result depend on array position: this field-name shift folded correctly in
  // one typing order and, in the other, resolved BOTH labels to `subtitle` —
  // two fields carrying one column, with `ok: true` and no error at all.
  describe('a window applies at most one substitution (final-review C1)', () => {
    const shift = [
      { type: 'content--post', from: 'title', to: 'headline' },
      { type: 'content--post', from: 'subtitle', to: 'title' },
    ]

    for (const [order, renames] of [
      ['declared forwards', shift],
      ['declared in the other order', [...shift].reverse()],
    ] as const) {
      it(`folds a field-name shift correctly, ${order}`, () => {
        const pending = { renames: [...renames], drops: [], fallbacks: {} }
        const base = { type: 'content--post', version: 'v2', live: ['v1', 'v2'], history: EMPTY_HISTORY, pending, current: 'v2' }
        expect(columnOf({ ...base, label: 'headline' })).toBe('title')
        expect(columnOf({ ...base, label: 'title' })).toBe('subtitle')
      })
    }

    it('folds a swap without collapsing both labels onto one column', () => {
      const pending = {
        renames: [
          { type: 'content--post', from: 'a', to: 'b' },
          { type: 'content--post', from: 'b', to: 'a' },
        ],
        drops: [], fallbacks: {},
      }
      const base = { type: 'content--post', version: 'v2', live: ['v1', 'v2'], history: EMPTY_HISTORY, pending, current: 'v2' }
      expect(columnOf({ ...base, label: 'a' })).toBe('b')
      expect(columnOf({ ...base, label: 'b' })).toBe('a')
    })

    it('applies one substitution per window for two renames sharing one history tag', () => {
      const history: VersionHistory = {
        renames: [
          { after: 'v1', type: 'content--post', from: 'title', to: 'headline' },
          { after: 'v1', type: 'content--post', from: 'subtitle', to: 'title' },
        ],
        drops: [], fallbacks: {},
      }
      const base = { type: 'content--post', version: 'v2', live: LIVE, history, pending: EMPTY_PENDING, current: 'v3' }
      expect(columnOf({ ...base, label: 'headline' })).toBe('title')
      expect(columnOf({ ...base, label: 'title' })).toBe('subtitle')
    })

    it('still chains across two windows — the same two renames, one tag apart', () => {
      const history: VersionHistory = {
        renames: [
          { after: 'v1', type: 'content--post', from: 'subtitle', to: 'title' },
          { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
        ],
        drops: [], fallbacks: {},
      }
      expect(
        columnOf({
          label: 'headline', type: 'content--post', version: 'v3',
          live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
        })
      ).toBe('subtitle')
    })

    it('does not let one window’s rename consume another type’s label', () => {
      const pending = {
        renames: [
          { type: 'content--post', from: 'title', to: 'headline' },
          { type: 'content--other', from: 'subtitle', to: 'title' },
        ],
        drops: [], fallbacks: {},
      }
      // The two entries are separate windows (different types), so folding
      // content--post's 'headline' must stop at 'title'.
      expect(
        columnOf({
          label: 'headline', type: 'content--post', version: 'v2',
          live: ['v1', 'v2'], history: EMPTY_HISTORY, pending, current: 'v2',
        })
      ).toBe('title')
    })
  })

  // A merge resolution can interleave two branches' appended blocks, so the
  // array order of history.renames need not match tag order. The fold must
  // sort by the `after` tag itself, not rely on array position.
  it('folds correctly when renames are listed out of chronological order', () => {
    const history: VersionHistory = {
      renames: [
        { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
        { after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' },
      ],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })
})

describe('validateRenameChain', () => {
  it('accepts a rename whose `from` exists in the version it followed', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots,
      current,
      currentVersion: 'v2',
    })
    expect(errors).toEqual([])
  })

  it('reports RENAME_CHAIN_BROKEN when `from` matches no known label', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'nonexistent', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots,
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
    expect(errors[0]!.message).toContain('nonexistent')
  })

  it('reports a rename naming a type that does not exist', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v1', type: 'content--ghost', from: 'a', to: 'b' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
    // Pins which branch fired: the type-missing message, not the label-missing
    // one — a rename's own `to` must not vouch for its own bogus `type`.
    expect(errors[0]!.message).toContain('content--ghost')
    expect(errors[0]!.message).toContain('no live version defines')
  })

  it('collects every broken entry rather than stopping at the first', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [
          { after: 'v1', type: 'content--ghost', from: 'a', to: 'b' },
          { after: 'v1', type: 'content--post', from: 'nope', to: 'title' },
        ],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(2)
  })

  // Finding 1's realistic trigger: a hand-edited or merge-resolved history.json
  // carrying "V1" (capital V) instead of "v1". Unchecked, versionNumber('V1')
  // is -1, which is LESS than every real version number — the entry would
  // silently apply to every version, including the earliest, breaking the
  // invariant that the earliest version's fold is always empty.
  it('reports RENAME_CHAIN_BROKEN for a malformed "after" tag', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'V1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
    expect(errors[0]!.message).toContain('V1')
  })

  // Final-review M4: a well-formed but out-of-range tag. `version:cut` only
  // ever writes a tag BELOW current, so "after": "v9" on a project at v2 names
  // a window that cannot have happened. Unchecked it surfaces as
  // AMBIGUOUS_RENAME only while the version holding the old label survives,
  // and becomes a silently wrong column once that version retires.
  it('reports RENAME_CHAIN_BROKEN for an "after" tag at or above the current version', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v9', type: 'content--post', from: 'title', to: 'headline' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
    expect(errors[0]!.message).toContain('v9')
  })

  it('rejects a tag equal to the current version, which no cut can produce', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v2', type: 'content--post', from: 'title', to: 'headline' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors.map((e) => e.code)).toEqual(['RENAME_CHAIN_BROKEN'])
    expect(errors[0]!.message).toContain('current version is v2')
  })

  it('does not report a malformed tag twice as out-of-range', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'V1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
  })

  // Final-review C1.2. Windowing makes a within-window `from`/`to` overlap
  // meaningless rather than merely order-dependent: read as a chain the author
  // should have recorded the net rename, read as a shift it needs two cuts.
  describe('within-window shape', () => {
    it('rejects a label that is both a `from` and a `to` in one pending window', () => {
      const current = makeRegistry([
        makeContentType('content--post', [{ name: 'headline' }, { name: 'title' }]),
      ])
      const snapshots = [{
        version: 'v1',
        registry: makeRegistry([makeContentType('content--post', [{ name: 'title' }, { name: 'subtitle' }])]),
      }]
      const errors = validateRenameChain({
        history: EMPTY_HISTORY,
        pending: {
          renames: [
            { type: 'content--post', from: 'title', to: 'headline' },
            { type: 'content--post', from: 'subtitle', to: 'title' },
          ],
          drops: [], fallbacks: {},
        },
        snapshots,
        current,
        currentVersion: 'v2',
      })
      expect(errors).toHaveLength(1)
      expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
      expect(errors[0]!.file).toBe('schemas/versions/pending.json')
      expect(errors[0]!.message).toContain('also renamed')
    })

    it('rejects a swap declared in one window', () => {
      const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])])
      const errors = validateRenameChain({
        history: EMPTY_HISTORY,
        pending: {
          renames: [
            { type: 'content--post', from: 'a', to: 'b' },
            { type: 'content--post', from: 'b', to: 'a' },
          ],
          drops: [], fallbacks: {},
        },
        snapshots: [],
        current,
        currentVersion: 'v2',
      })
      expect(errors.filter((e) => e.code === 'RENAME_CHAIN_BROKEN').length).toBeGreaterThan(0)
    })

    it('rejects two renames in one history window targeting the same label', () => {
      const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
      const snapshots = [{
        version: 'v1',
        registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])]),
      }]
      const errors = validateRenameChain({
        history: {
          renames: [
            { after: 'v1', type: 'content--post', from: 'a', to: 'title' },
            { after: 'v1', type: 'content--post', from: 'b', to: 'title' },
          ],
          drops: [], fallbacks: {},
        },
        pending: EMPTY_PENDING,
        snapshots,
        current,
        currentVersion: 'v2',
      })
      expect(errors).toHaveLength(1)
      expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
      expect(errors[0]!.message).toContain('both rename a field to "title"')
    })

    it('accepts the same two renames split across two windows', () => {
      const current = makeRegistry([
        makeContentType('content--post', [{ name: 'headline' }, { name: 'title' }]),
      ])
      const snapshots = [
        {
          version: 'v1',
          registry: makeRegistry([makeContentType('content--post', [{ name: 'title' }, { name: 'subtitle' }])]),
        },
        {
          version: 'v2',
          registry: makeRegistry([makeContentType('content--post', [{ name: 'title' }, { name: 'title2' }])]),
        },
      ]
      const errors = validateRenameChain({
        history: {
          renames: [
            { after: 'v1', type: 'content--post', from: 'subtitle', to: 'title2' },
            { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
          ],
          drops: [], fallbacks: {},
        },
        pending: { renames: [{ type: 'content--post', from: 'title2', to: 'title' }], drops: [], fallbacks: {} },
        snapshots,
        current,
        currentVersion: 'v3',
      })
      expect(errors).toEqual([])
    })

    it('does not confuse two types’ renames as one window', () => {
      const current = makeRegistry([
        makeContentType('content--post', [{ name: 'headline' }]),
        makeContentType('content--other', [{ name: 'title' }]),
      ])
      const errors = validateRenameChain({
        history: EMPTY_HISTORY,
        pending: {
          renames: [
            { type: 'content--post', from: 'title', to: 'headline' },
            { type: 'content--other', from: 'subtitle', to: 'title' },
          ],
          drops: [], fallbacks: {},
        },
        snapshots: [{
          version: 'v1',
          registry: makeRegistry([
            makeContentType('content--post', [{ name: 'title' }]),
            makeContentType('content--other', [{ name: 'subtitle' }]),
          ]),
        }],
        current,
        currentVersion: 'v2',
      })
      expect(errors).toEqual([])
    })
  })

  // The pending path is the primary trigger the design names for this check
  // (a hand-written pending.json entry with a typo), so it needs its own test
  // pinning the file attribution and the currentVersion-as-`after` wiring.
  it('reports a broken pending rename against the pending file', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: EMPTY_HISTORY,
      pending: {
        renames: [{ type: 'content--post', from: 'nonexistent', to: 'headline' }],
        drops: [], fallbacks: {},
      },
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
    expect(errors[0]!.file).toBe('schemas/versions/pending.json')
    expect(errors[0]!.message).toContain('nonexistent')
  })
})
