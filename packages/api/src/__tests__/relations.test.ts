import { describe, it, expect } from 'vitest'
import { resolveRelationField } from '../relations'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// A db double that answers the single media SELECT resolveRelationField issues.
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
