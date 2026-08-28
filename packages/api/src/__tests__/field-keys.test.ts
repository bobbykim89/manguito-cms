import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { createFieldKeyMap, isColumnBacked } from '../field-keys'
import {
  divergentTextField,
  divergentMediaField,
  identityTextField,
  paragraphField,
  manyToManyField,
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
})
