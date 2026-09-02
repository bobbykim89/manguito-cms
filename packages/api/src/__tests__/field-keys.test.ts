import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { createFieldKeyMap, isColumnBacked } from '../field-keys'
import {
  divergentTextField,
  divergentMediaField,
  identityTextField,
  paragraphField,
  manyToManyField,
  renamedTombstoneField,
  collisionLiveField,
  collisionTombstoneField,
} from '../field-keys.test-fixtures'

const FIELDS = [
  divergentTextField,
  divergentMediaField,
  identityTextField,
  paragraphField,
  manyToManyField,
]

describe('isColumnBacked', () => {
  it('accepts a field with a real column', () => {
    expect(isColumnBacked(divergentTextField)).toBe(true)
  })

  it('rejects a paragraph field (no column)', () => {
    expect(isColumnBacked(paragraphField)).toBe(false)
  })

  it('rejects a many-to-many reference (junction owns the association)', () => {
    expect(isColumnBacked(manyToManyField)).toBe(false)
  })
})

describe('createFieldKeyMap', () => {
  it('maps a label to its column and back', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.columnFor('title')).toBe('blog_title')
    expect(m.labelFor('blog_title')).toBe('title')
  })

  it('reports divergence so callers can skip work when there is none', () => {
    expect(createFieldKeyMap(FIELDS).diverges).toBe(true)
    expect(createFieldKeyMap([identityTextField]).diverges).toBe(false)
  })

  it('lists labels for column-backed fields only', () => {
    expect(createFieldKeyMap(FIELDS).labels.sort()).toEqual(['hero', 'summary', 'title'])
  })

  it('converts a label-keyed body to storage keys', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toStorage({ title: 'Hi', hero: 'media-1', summary: 'S' })).toEqual({
      blog_title: 'Hi',
      blog_hero_image: 'media-1',
      summary: 'S',
    })
  })

  it('converts a storage-keyed row to labels', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toLabels({ blog_title: 'Hi', blog_hero_image: 'media-1', summary: 'S' })).toEqual({
      title: 'Hi',
      hero: 'media-1',
      summary: 'S',
    })
  })

  it('passes system fields and paragraph labels through untouched', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toLabels({ id: 'x', slug: 's', published: true, cards: [], tags: [] })).toEqual({
      id: 'x',
      slug: 's',
      published: true,
      cards: [],
      tags: [],
    })
  })

  it('preserves an explicit null rather than dropping the key', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toStorage({ title: null })).toEqual({ blog_title: null })
  })

  it("throws when a PARAGRAPH label collides with another field's column name", () => {
    // The scenario Stage 2 makes reachable: `blog_title` was the original name of
    // the field now labelled `title`, so the column kept it. An author then adds a
    // paragraph field named `blog_title` — labels are still unique, so nothing
    // upstream objects, but the paragraph array would land on the row under the
    // text field's column and toLabels would then serve it as `title`.
    const collidingParagraph: ParsedField = { ...paragraphField, name: 'blog_title' }
    expect(() => createFieldKeyMap([divergentTextField, collidingParagraph])).toThrow(
      /^Fatal: field key map failed to build — field label "blog_title" collides with the storage column of field "title"/
    )
  })

  it("throws when a many-to-many label collides with another field's column name", () => {
    const collidingJunction: ParsedField = { ...manyToManyField, name: 'blog_title' }
    expect(() => createFieldKeyMap([divergentTextField, collidingJunction])).toThrow(/collides/i)
  })

  it('accepts a paragraph label that collides with nothing', () => {
    expect(() => createFieldKeyMap(FIELDS)).not.toThrow()
  })

  it("throws when a label collides with another field's column name", () => {
    const collidingLabel: ParsedField = {
      ...identityTextField,
      name: 'blog_title',
      db_column: { column_name: 'other_col', column_type: 'varchar', nullable: true },
    } as ParsedField
    expect(() => createFieldKeyMap([divergentTextField, collidingLabel])).toThrow(
      /collides/i
    )
  })

  describe('tombstones', () => {
    const TOMBSTONE_FIELDS = [divergentTextField, identityTextField, renamedTombstoneField]

    it('excludes a tombstone from labels', () => {
      const m = createFieldKeyMap(TOMBSTONE_FIELDS)
      expect(m.labels.sort()).toEqual(['summary', 'title'])
      expect(m.labels).not.toContain('legacy_desc')
    })

    it('excludes a tombstone from columnFor/labelFor', () => {
      const m = createFieldKeyMap(TOMBSTONE_FIELDS)
      expect(m.columnFor('legacy_desc')).toBeUndefined()
      expect(m.labelFor('blog_desc')).toBeUndefined()
    })

    // The naive fix — skipping tombstones only in the map-build loop — passes
    // this test's `labels`/`columnFor` assertions above but fails here: `remap`
    // lets an unmapped key through unchanged, so the retained column
    // (`blog_desc`, emitted by db codegen on every row) would land in the
    // response verbatim instead of being dropped.
    it('drops the retained column from a row rather than passing it through', () => {
      const m = createFieldKeyMap(TOMBSTONE_FIELDS)
      const row = { blog_title: 'Hi', summary: 'S', blog_desc: 'dead value' }
      const result = m.toLabels(row)
      expect(result).toEqual({ title: 'Hi', summary: 'S' })
      expect(result).not.toHaveProperty('blog_desc')
    })

    it("drops a tombstone's key from a write body instead of writing it to the retained column", () => {
      const m = createFieldKeyMap(TOMBSTONE_FIELDS)
      const body = { title: 'Hi', legacy_desc: 'client-supplied' }
      const result = m.toStorage(body)
      expect(result).toEqual({ blog_title: 'Hi' })
      expect(result).not.toHaveProperty('legacy_desc')
      expect(result).not.toHaveProperty('blog_desc')
    })

    it('drops a renamed-then-removed tombstone under BOTH its current name and its retained column', () => {
      const m = createFieldKeyMap(TOMBSTONE_FIELDS)
      // toStorage sees label-keyed input — the tombstone's current name.
      expect(m.toStorage({ legacy_desc: 'x' })).toEqual({})
      // toLabels sees storage-keyed input — the tombstone's retained column.
      expect(m.toLabels({ blog_desc: 'x' })).toEqual({})
    })

    it('leaves a non-tombstone field completely unaffected', () => {
      const m = createFieldKeyMap(TOMBSTONE_FIELDS)
      expect(m.columnFor('title')).toBe('blog_title')
      expect(m.labelFor('blog_title')).toBe('title')
      expect(m.toStorage({ title: 'Hi' })).toEqual({ blog_title: 'Hi' })
      expect(m.toLabels({ blog_title: 'Hi' })).toEqual({ title: 'Hi' })
    })

    it("still throws when a live field's label collides with a tombstone's column", () => {
      expect(() =>
        createFieldKeyMap([collisionLiveField, collisionTombstoneField])
      ).toThrow(
        /^Fatal: field key map failed to build — field label "description" collides with the storage column of field "x"/
      )
    })
  })
})
