import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { defaultForField } from '../field-defaults'

const rel = (field_type: 'paragraph' | 'reference', r: 'one-to-one' | 'one-to-many' | 'many-to-many'): ParsedField =>
  ({
    name: 'x', label: 'X', field_type, required: false, nullable: true, order: 0,
    validation: { required: false }, db_column: null,
    ui_component: field_type === 'paragraph'
      ? { component: 'paragraph-embed', ref: 'paragraph--p', rel: r }
      : { component: 'typeahead-select', ref: 'taxonomy--t', rel: r },
  }) as ParsedField

describe('defaultForField', () => {
  it('starts "one" relations empty as null', () => {
    // MUTATION: keep `case 'paragraph': return []`. The one-to-one editor would
    // then receive an array.
    expect(defaultForField(rel('paragraph', 'one-to-one'))).toBeNull()
    expect(defaultForField(rel('reference', 'one-to-many'))).toBeNull()
  })
  it('starts "many" relations empty as []', () => {
    // MUTATION: return null for every relation.
    expect(defaultForField(rel('paragraph', 'one-to-many'))).toEqual([])
    expect(defaultForField(rel('reference', 'many-to-many'))).toEqual([])
  })
})
