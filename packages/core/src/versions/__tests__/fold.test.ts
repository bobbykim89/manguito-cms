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
})
