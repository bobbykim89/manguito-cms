import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { initialTaxonomyForm } from '../taxonomy-form'

const base = { label: 'X', required: false, nullable: true, order: 0, validation: { required: false } }

const fields: ParsedField[] = [
  {
    ...base, name: 'name', field_type: 'text/plain',
    db_column: { column_name: 'name', column_type: 'varchar', nullable: true },
    ui_component: { component: 'text-input' },
  },
  {
    ...base, name: 'parent', field_type: 'reference',
    db_column: { column_name: 'parent', column_type: 'uuid', nullable: true },
    ui_component: { component: 'typeahead-select', ref: 'taxonomy--t', rel: 'one-to-one' },
  },
  {
    ...base, name: 'blocks', field_type: 'paragraph', db_column: null,
    ui_component: { component: 'paragraph-embed', ref: 'paragraph--p', rel: 'one-to-many' },
  },
  {
    ...base, name: 'hero', field_type: 'paragraph', db_column: null,
    ui_component: { component: 'paragraph-embed', ref: 'paragraph--p', rel: 'one-to-one' },
  },
  {
    ...base, name: 'related', field_type: 'reference',
    db_column: {
      column_name: '', column_type: 'uuid', nullable: true,
      junction: { table_name: 'junction_taxonomy_t_related', left_column: 'taxonomy_t_id', right_column: 'taxonomy_t_id', right_table: 'taxonomy_t' },
    },
    ui_component: { component: 'typeahead-select', ref: 'taxonomy--t', rel: 'many-to-many' },
  },
  {
    ...base, name: 'computed', field_type: 'programmatic',
    db_column: null,
    ui_component: { component: 'computed-display' },
  },
] as unknown as ParsedField[]

describe('initialTaxonomyForm', () => {
  it('leaves out every field the taxonomy read does not return', () => {
    // MUTATION: put every non-programmatic field into the form (the old
    // initForm). The paragraph and many-to-many keys would then be sent as
    // null, which the api rejects with a 422 for a "many" field and which
    // erases a one-to-one paragraph.
    const form = initialTaxonomyForm(fields, { name: 'Tag', parent: 'p-1' })
    expect(form).not.toHaveProperty('blocks')
    expect(form).not.toHaveProperty('hero')
    expect(form).not.toHaveProperty('related')
    expect(form).not.toHaveProperty('computed')
  })

  it('keeps column-backed fields, from the source or their default', () => {
    // MUTATION: drop every reference field (filter on field_type instead of
    // storage). A one-to-one reference has a column and must stay editable.
    expect(initialTaxonomyForm(fields, { name: 'Tag', parent: 'p-1' })).toEqual({
      name: 'Tag',
      parent: 'p-1',
    })
    expect(initialTaxonomyForm(fields)).toEqual({ name: '', parent: null })
  })
})
