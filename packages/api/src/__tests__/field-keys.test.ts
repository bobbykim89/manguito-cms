import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { createFieldKeyMap, createFieldKeyMapFromProjection, isColumnBacked } from '../field-keys'
import {
  divergentTextField,
  divergentMediaField,
  divergentReferenceField,
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

  it("maps a field named after another field's column correctly in both directions", () => {
    // divergentTextField is `title` over `blog_title`; this field is NAMED
    // `blog_title` but owns `other_col`. A column-backed name is never a row
    // key, so nothing is ambiguous.
    // MUTATION: in buildFieldKeyMap's collision check, inspect every field
    // again rather than only those with no column of their own. The map then
    // throws on build.
    const namedAfterAColumn: ParsedField = {
      ...identityTextField,
      name: 'blog_title',
      db_column: { column_name: 'other_col', column_type: 'varchar', nullable: true },
    } as ParsedField
    const m = createFieldKeyMap([divergentTextField, namedAfterAColumn])

    expect(m.toLabels({ blog_title: 'T', other_col: 'O' })).toEqual({ title: 'T', blog_title: 'O' })
    expect(m.toStorage({ title: 'T', blog_title: 'O' })).toEqual({ blog_title: 'T', other_col: 'O' })
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

    it("maps a live label equal to a tombstone's column correctly in both directions", () => {
      // The case that shows why the drop-set must split. collisionLiveField is
      // `description` over `d2`; collisionTombstoneField is `x` over the
      // retained column `description`.
      // MUTATION: restore one shared drop-set for both directions. Its
      // `description` entry (the tombstone's column) then strips the LIVE
      // field's `description → d2` pair, and toStorage drops the write.
      const m = createFieldKeyMap([collisionLiveField, collisionTombstoneField])

      expect(m.toLabels({ d2: 'live', description: 'retained' })).toEqual({ description: 'live' })
      expect(m.toStorage({ description: 'live' })).toEqual({ d2: 'live' })
      // The tombstone itself stays refused in both directions.
      expect(m.toStorage({ x: 'nope' })).toEqual({})
    })
  })
})

describe('createFieldKeyMapFromProjection', () => {
  const projection = {
    fields: [
      { column_name: 'blog_title', exposed_as: 'title', required: false },
      { column_name: 'summary', exposed_as: 'summary', required: false },
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
    const identity = { fields: [{ column_name: 'title', exposed_as: 'title', required: false }] }
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
    // dropped from the READ side. Without the drop, remap would pass the raw
    // 'blog_desc' key straight through toLabels, since a retained column is
    // genuinely present on the database row.
    const map = createFieldKeyMapFromProjection(projection, [renamedTombstoneField])

    const row = { blog_title: 'Hi', summary: 'S', blog_desc: 'dead value' }
    const labelResult = map.toLabels(row)
    expect(labelResult).toEqual({ title: 'Hi', summary: 'S' })
    expect(labelResult).not.toHaveProperty('blog_desc')

    // Section 3 (schema versioning 2f): toStorage reads LABEL-keyed input and
    // consults droppedLabels only, never droppedColumns. 'blog_desc' is a
    // column, not a label — it is not in droppedLabels, so it is not this
    // map's business on the write side and passes through unmapped. Only the
    // tombstone's NAME ('legacy_desc') is refused, because that is a label.
    const body = { title: 'Hi', legacy_desc: 'client-supplied', blog_desc: 'raw-column-supplied' }
    const storageResult = map.toStorage(body)
    expect(storageResult).toEqual({ blog_title: 'Hi', blog_desc: 'raw-column-supplied' })
    expect(storageResult).not.toHaveProperty('legacy_desc')
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

  it('accepts a version that exposes a field under a label other than its own column', () => {
    // The rename-away-and-back trigger. Current's field is named `summary` over
    // column `summary` — name and column coincide, which is the default when no
    // `column` is declared — and a still-live older version exposes that same
    // column as `blurb`. The collision check walks current's NAMES against this
    // version's exposed COLUMNS, so it saw `summary` mapped to a different
    // label and threw, taking createCmsApp down synchronously at startup for
    // EVERY version. One field seen under two names is not an ambiguity: there
    // is exactly one column and exactly one value.
    const renamedOntoItsOwnColumn = {
      fields: [{ column_name: 'summary', exposed_as: 'blurb', required: false }],
    }
    expect(() =>
      createFieldKeyMapFromProjection(renamedOntoItsOwnColumn, [identityTextField])
    ).not.toThrow()

    const map = createFieldKeyMapFromProjection(renamedOntoItsOwnColumn, [identityTextField])
    expect(map.columnFor('blurb')).toBe('summary')
    expect(map.labelFor('summary')).toBe('blurb')
    expect(map.toLabels({ summary: 'S' })).toEqual({ blurb: 'S' })
    expect(map.toStorage({ blurb: 'S' })).toEqual({ summary: 'S' })
  })

  it('maps a field named after a column this version renames correctly', () => {
    // This test used to claim the second field's value lands in the row under
    // its own name. That was false for a text field even before — SELECT *
    // puts it under its column — and Task 1 made it false for relations too.
    // MUTATION: inspect every field in the collision check again.
    const renamesSomeoneElsesColumn = {
      fields: [{ column_name: 'blog_title', exposed_as: 'heading', required: false }],
    }
    const namedAfterThatColumn: ParsedField = {
      ...identityTextField,
      name: 'blog_title',
      db_column: { column_name: 'other_col', column_type: 'varchar', nullable: true },
    }
    const m = createFieldKeyMapFromProjection(renamesSomeoneElsesColumn, [
      divergentTextField,
      namedAfterThatColumn,
    ])

    // This version exposes only `blog_title`, as `heading`; `other_col` is not exposed.
    expect(m.toLabels({ blog_title: 'T', other_col: 'O' })).toEqual({ heading: 'T' })
    expect(m.toStorage({ heading: 'T' })).toEqual({ blog_title: 'T' })
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

describe('split drop-sets', () => {
  it("does not serve another field's data when a version's label equals a different field's name", () => {
    // #2. Current has `a` (column a) and `b` (column b). v1 exposes column a
    // under the label `b`, and never had field b at all.
    // MUTATION: restore one shared drop-set. Un-dropping the projected label
    // `b` then also un-drops field b's column `b`, which passes through remap:
    // v1 receives field b's value and field a's is lost.
    const a: ParsedField = {
      ...identityTextField,
      name: 'a',
      db_column: { column_name: 'a', column_type: 'varchar', nullable: true },
    }
    const b: ParsedField = {
      ...identityTextField,
      name: 'b',
      db_column: { column_name: 'b', column_type: 'varchar', nullable: true },
    }
    const m = createFieldKeyMapFromProjection(
      { fields: [{ column_name: 'a', exposed_as: 'b' }] },
      [a, b]
    )

    expect(m.toLabels({ a: 'v1 value', b: 'NEW FIELD value' })).toEqual({ b: 'v1 value' })
  })

  it('round-trips a renamed relation through the admin read and write paths', () => {
    // Review Focus #4. The admin panel reads through toLabels and writes
    // through toStorage, both on current's map. The tombstone makes both drop
    // sets non-empty, which is what lets this test notice them being crossed.
    // MUTATION: wire each direction to the OTHER set — toLabels consulting
    // droppedLabels, toStorage consulting droppedColumns. The tombstone's
    // retained column `blog_desc` then leaks into the read.
    const m = createFieldKeyMap([divergentReferenceField, renamedTombstoneField])

    expect(m.toLabels({ id: 'p1', category_id: { id: 'c1', name: 'Cat' }, blog_desc: 'retained' }))
      .toEqual({ id: 'p1', category: { id: 'c1', name: 'Cat' } })
    expect(m.toStorage({ category: 'c1', legacy_desc: 'refused' })).toEqual({ category_id: 'c1' })
  })
})
