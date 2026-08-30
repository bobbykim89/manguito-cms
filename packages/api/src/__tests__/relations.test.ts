import { describe, it, expect } from 'vitest'
import { resolveRelationField } from '../relations'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// A db double that answers the single target-row SELECT resolveRelationField
// issues (media or reference — both are one `SELECT * ... WHERE id IN (...)`).
function mediaDb(rows: Record<string, unknown>[]): DrizzlePostgresInstance {
  return {
    execute: async () => ({ rows }),
  } as unknown as DrizzlePostgresInstance
}

describe('resolveRelationField with a divergent media field', () => {
  it('resolves into the label and drops the raw FK key', async () => {
    const rows = [{ id: 'c1', blog_hero_image: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({
      id: 'c1',
      hero: { id: 'm1', url: '/uploads/a.png' },
    })
    expect(rows[0]).not.toHaveProperty('blog_hero_image')
  })

  it('still overwrites in place when label and column are identical', async () => {
    const rows = [{ id: 'c1', hero: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'hero',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', hero: { id: 'm1', url: '/uploads/a.png' } })
  })

  it('nulls the label and drops the FK key when the FK is empty', async () => {
    const rows = [{ id: 'c1', blog_hero_image: '' }]
    const db = mediaDb([])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', hero: null })
  })
})

// resolveRelationField is destructive: the resolved object replaces the raw FK,
// and a divergent label deletes the FK key outright. The same row object really
// does arrive twice — target rows are cached by `table:id` so two parents share
// one object, and the GraphQL dataloaders do not memoize by parent identity.
describe('resolveRelationField is idempotent', () => {
  it('keeps a resolved media value across a second pass (divergent label)', async () => {
    const rows = [{ id: 'c1', blog_hero_image: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])
    const rel = { type: 'media', fk_column: 'blog_hero_image' } as const
    const cache = new Map<string, unknown>()

    await resolveRelationField(db, rows, 'hero', rel, cache)
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]).toEqual({ id: 'c1', hero: { id: 'm1', url: '/uploads/a.png' } })
  })

  it('keeps a resolved media value across a second pass (label === column)', async () => {
    const rows = [{ id: 'c1', hero: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])
    const rel = { type: 'media', fk_column: 'hero' } as const
    const cache = new Map<string, unknown>()

    await resolveRelationField(db, rows, 'hero', rel, cache)
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]).toEqual({ id: 'c1', hero: { id: 'm1', url: '/uploads/a.png' } })
  })

  it('keeps a resolved reference target across a second pass', async () => {
    const rows = [{ id: 'c1', category_id: 't1' }]
    const db = mediaDb([{ id: 't1', label: 'News' }])
    const rel = {
      type: 'reference',
      table: 'taxonomy_category',
      fk_column: 'category_id',
    } as const
    const cache = new Map<string, unknown>()

    await resolveRelationField(db, rows, 'category', rel, cache)
    await resolveRelationField(db, rows, 'category', rel, cache)

    expect(rows[0]).toEqual({ id: 'c1', category: { id: 't1', label: 'News' } })
  })

  it('resolves once when one shared row object appears twice in the batch', async () => {
    const shared: Record<string, unknown> = { id: 'c1', blog_hero_image: 'm1' }
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, [shared, shared], 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(shared).toEqual({ id: 'c1', hero: { id: 'm1', url: '/uploads/a.png' } })
  })

  it('leaves a null resolution null on a second pass', async () => {
    const rows = [{ id: 'c1', blog_hero_image: '' }]
    const db = mediaDb([])
    const rel = { type: 'media', fk_column: 'blog_hero_image' } as const
    const cache = new Map<string, unknown>()

    await resolveRelationField(db, rows, 'hero', rel, cache)
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]).toEqual({ id: 'c1', hero: null })
  })
})
