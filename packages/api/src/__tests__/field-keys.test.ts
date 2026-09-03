import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { createFieldKeyMap, createFieldKeyMapFromProjection, isColumnBacked } from '../field-keys'
import {
  divergentTextField,
  divergentMediaField,
  identityTextField,
  paragraphField,
  manyToManyField,
  renamedTombstoneField,
  retainedColumnTombstoneField,
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

describe('createFieldKeyMapFromProjection', () => {
  const projection = {
    fields: [
      { column_name: 'blog_title', exposed_as: 'title' },
      { column_name: 'summary', exposed_as: 'summary' },
    ],
  }

  it('maps a label to the column the projection names', () => {
    // The rename case: the projection says v1 exposes column blog_title under
    // the name 'title'. A name-keyed implementation would map title -> title.
    const map = createFieldKeyMapFromProjection(projection, [])
    expect(map.columnFor('title')).toBe('blog_title')
    expect(map.labelFor('blog_title')).toBe('title')
  })

  it("maps a row back to that version's labels", () => {
    const map = createFieldKeyMapFromProjection(projection, [])
    expect(map.toLabels({ blog_title: 'Hi', summary: 'S' })).toEqual({ title: 'Hi', summary: 'S' })
  })

  it('maps a request body forward to storage keys', () => {
    const map = createFieldKeyMapFromProjection(projection, [])
    expect(map.toStorage({ title: 'Hi' })).toEqual({ blog_title: 'Hi' })
  })

  it('reports the projection\'s labels as the filter and sort surface', () => {
    const map = createFieldKeyMapFromProjection(projection, [])
    expect([...map.labels].sort()).toEqual(['summary', 'title'])
  })

  it('reports diverges when a label differs from its column', () => {
    expect(createFieldKeyMapFromProjection(projection, []).diverges).toBe(true)
    const identity = { fields: [{ column_name: 'title', exposed_as: 'title' }] }
    expect(createFieldKeyMapFromProjection(identity, []).diverges).toBe(false)
  })

  it("still throws when a NON-projected field's label collides with a column", () => {
    // The reason this constructor takes allFields at all. A paragraph field is
    // absent from every projection (it has no column), but its label reaches
    // the same key space as storage columns before toLabels runs — so a
    // paragraph field named 'blog_title' would overwrite that column's value
    // and then be renamed onto 'title'. The projection alone cannot see it.
    const paragraphNamedAfterAColumn: ParsedField = {
      name: 'blog_title',
      label: 'Cards',
      field_type: 'paragraph',
      required: false,
      nullable: true,
      order: 9,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' },
    }
    expect(() => createFieldKeyMapFromProjection(projection, [paragraphNamedAfterAColumn])).toThrow(
      /collides with the storage column/
    )
  })

  it('does not throw when allFields is consistent with the projection', () => {
    const ordinaryParagraph: ParsedField = {
      name: 'cards',
      label: 'Cards',
      field_type: 'paragraph',
      required: false,
      nullable: true,
      order: 9,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' },
    }
    expect(() => createFieldKeyMapFromProjection(projection, [ordinaryParagraph])).not.toThrow()
  })

  it("drops a tombstone's column the projection does not expose", () => {
    // renamedTombstoneField: name 'legacy_desc', column 'blog_desc', removed.
    // The projection (blog_title/title, summary/summary) never names
    // 'blog_desc' — this version does not retain it — so it must be actively
    // dropped from both maps. Without the drop, remap would pass the raw
    // 'blog_desc' key straight through toLabels, since a retained column is
    // genuinely present on the database row.
    const map = createFieldKeyMapFromProjection(projection, [renamedTombstoneField])

    const row = { blog_title: 'Hi', summary: 'S', blog_desc: 'dead value' }
    const labelResult = map.toLabels(row)
    expect(labelResult).toEqual({ title: 'Hi', summary: 'S' })
    expect(labelResult).not.toHaveProperty('blog_desc')

    const body = { title: 'Hi', legacy_desc: 'client-supplied', blog_desc: 'raw-column-supplied' }
    const storageResult = map.toStorage(body)
    expect(storageResult).toEqual({ blog_title: 'Hi' })
    expect(storageResult).not.toHaveProperty('legacy_desc')
    expect(storageResult).not.toHaveProperty('blog_desc')
  })

  it('does not drop a tombstone column this projection still exposes', () => {
    // retainedColumnTombstoneField: name 'legacy_title', column 'blog_title',
    // removed — the older-live-version situation, where the current schema has
    // renamed-and-removed the field but THIS version's projection still maps
    // column 'blog_title' to label 'title'. Dropping it here would delete real
    // data from this version's responses.
    const map = createFieldKeyMapFromProjection(projection, [retainedColumnTombstoneField])
    expect(map.toLabels({ blog_title: 'Hi', summary: 'S' })).toEqual({ title: 'Hi', summary: 'S' })
  })

  it('drops a LIVE field added after this version was cut, not just a tombstone', () => {
    // The leak this widening closes: a field added to the CURRENT schema
    // after this version was cut is live (`removed !== true`), so a
    // tombstone-only drop-set skips it entirely — and remap passes an
    // unmapped key straight through, so its raw storage column would leak
    // into this version's response the moment `SELECT *` returns it. Every
    // other projection fixture in this file is a superset-or-equal of its
    // `allFields`; this is the one shape where `allFields` holds a field the
    // projection does not. Column differs from name so the assertion below
    // can only pass if the drop is keyed off the column, not the label.
    const subtitleField: ParsedField = {
      name: 'subtitle',
      label: 'Subtitle',
      field_type: 'text/plain',
      required: false,
      nullable: true,
      order: 11,
      validation: { required: false },
      db_column: { column_name: 'blog_sub', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    }
    const map = createFieldKeyMapFromProjection(projection, [subtitleField])

    const row = { blog_title: 'Hi', summary: 'S', blog_sub: 'LEAKED' }
    const result = map.toLabels(row)
    expect(result).toEqual({ title: 'Hi', summary: 'S' })
    expect(result).not.toHaveProperty('blog_sub')
    expect(result).not.toHaveProperty('subtitle')
  })
})
