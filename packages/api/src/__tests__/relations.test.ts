import { describe, it, expect } from 'vitest'
import { resolveRelationField } from '../relations'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { createFieldKeyMapFromProjection } from '../field-keys'
import { divergentTextField, divergentMediaField } from '../field-keys.test-fixtures'

// A db double that answers the single target-row SELECT resolveRelationField
// issues (media or reference — both are one `SELECT * ... WHERE id IN (...)`).
function mediaDb(rows: Record<string, unknown>[]): DrizzlePostgresInstance {
  return {
    execute: async () => ({ rows }),
  } as unknown as DrizzlePostgresInstance
}

describe('resolveRelationField with a divergent media field', () => {
  it('resolves in place under the storage column, never under the field name', async () => {
    // MUTATION: restore `row[fieldName] = …; if (dropFk) delete row[rel.fk_column]`
    // in the media branch. The object then lands under `hero` and the column
    // disappears, so both assertions fail.
    const rows = [{ id: 'c1', blog_hero_image: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: { id: 'm1', url: '/uploads/a.png' } })
    expect(rows[0]).not.toHaveProperty('hero')
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

  it('nulls the column in place when the FK is empty', async () => {
    // Updated for column-as-identity: the empty-FK path now nulls the storage
    // column rather than the label, and never drops it.
    const rows = [{ id: 'c1', blog_hero_image: '' }]
    const db = mediaDb([])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: null })
  })
})

// resolveRelationField resolves IN PLACE under the storage column, and the
// resolved object (never a bare id) is what needsFkResolution checks to skip
// a row it has already visited. The same row object really does arrive twice
// — target rows are cached by `table:id` so two parents share one object, and
// the GraphQL dataloaders do not memoize by parent identity.
describe('resolveRelationField is idempotent', () => {
  it('keeps a resolved media value across a second pass (divergent label)', async () => {
    const rows = [{ id: 'c1', blog_hero_image: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])
    const rel = { type: 'media', fk_column: 'blog_hero_image' } as const
    const cache = new Map<string, unknown>()

    await resolveRelationField(db, rows, 'hero', rel, cache)
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: { id: 'm1', url: '/uploads/a.png' } })
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

    expect(rows[0]).toEqual({ id: 'c1', category_id: { id: 't1', label: 'News' } })
  })

  it('resolves once when one shared row object appears twice in the batch', async () => {
    const shared: Record<string, unknown> = { id: 'c1', blog_hero_image: 'm1' }
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, [shared, shared], 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(shared).toEqual({ id: 'c1', blog_hero_image: { id: 'm1', url: '/uploads/a.png' } })
  })

  it('leaves a null resolution null on a second pass', async () => {
    const rows = [{ id: 'c1', blog_hero_image: '' }]
    const db = mediaDb([])
    const rel = { type: 'media', fk_column: 'blog_hero_image' } as const
    const cache = new Map<string, unknown>()

    await resolveRelationField(db, rows, 'hero', rel, cache)
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: null })
  })
})

describe('resolveRelationField — column-keyed resolution', () => {
  it('resolves a divergent reference in place under its storage column', async () => {
    // MUTATION: restore the name-keyed write in the REFERENCE branch.
    const rows = [{ id: 'p1', category_id: 'c1' }]
    const db = mediaDb([{ id: 'c1', name: 'Cat One' }])

    await resolveRelationField(db, rows, 'category', {
      type: 'reference',
      table: 'cats',
      fk_column: 'category_id',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'p1', category_id: { id: 'c1', name: 'Cat One' } })
    expect(rows[0]).not.toHaveProperty('category')
  })

  it('keeps the column present as null when the foreign key is null', async () => {
    // Review Focus #1. MUTATION: restore `row[fieldName] = null; if (dropFk)
    // delete row[rel.fk_column]` in the media branch's empty-FK path. The column
    // is deleted, so `in` returns false.
    const rows: Array<Record<string, unknown>> = [{ id: 'c1', blog_hero_image: null }]

    await resolveRelationField(mediaDb([]), rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: null })
    expect('blog_hero_image' in rows[0]!).toBe(true)
  })

  it('is idempotent: a second pass over an already-resolved row does not re-resolve it', async () => {
    // needsFkResolution exists because reference targets are cached by table:id,
    // so the same object reaches several parents and a row may be visited twice.
    // MUTATION: make needsFkResolution always return true. The second pass then
    // treats the resolved object as a foreign key, queries again, and overwrites
    // the row with null — both assertions fail.
    const rows: Array<Record<string, unknown>> = [{ id: 'c1', blog_hero_image: 'm1' }]
    let queries = 0
    const db = {
      execute: async () => {
        queries++
        return { rows: [{ id: 'm1', url: '/a.png' }] }
      },
    } as unknown as DrizzlePostgresInstance
    const cache = new Map<string, unknown>()
    const rel = { type: 'media' as const, fk_column: 'blog_hero_image' }

    await resolveRelationField(db, rows, 'hero', rel, cache)
    const first = rows[0]!['blog_hero_image']
    // Without this, the test passes vacuously on the ORIGINAL code: there the
    // first pass deletes the column, so `first` is undefined and toBe below
    // compares undefined with undefined.
    expect(first).toEqual({ id: 'm1', url: '/a.png' })
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]!['blog_hero_image']).toBe(first)
    expect(queries).toBe(1)
  })

  it("does not serve a resolved relation under another field's label on an older version", async () => {
    // The spec's reference-collision case, and where today's code genuinely
    // mis-serves data. v1 exposes the TITLE's column under the label `hero`, and
    // does not expose the media column at all. Today the media object is written
    // under its name `hero`, which no drop-set entry covers, so it passes through
    // toLabels and overwrites the title that v1 legitimately calls `hero`.
    // MUTATION: restore the name-keyed media write. The output is then
    // `{ id: 'p1', hero: { id: 'm1' } }`.
    const rows: Array<Record<string, unknown>> = [{ id: 'p1', blog_title: 'T', blog_hero_image: 'm1' }]
    await resolveRelationField(mediaDb([{ id: 'm1' }]), rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    const v1 = createFieldKeyMapFromProjection(
      { fields: [{ column_name: 'blog_title', exposed_as: 'hero' }] },
      [divergentTextField, divergentMediaField]
    )

    expect(v1.toLabels(rows[0]!)).toEqual({ id: 'p1', hero: 'T' })
  })
})
