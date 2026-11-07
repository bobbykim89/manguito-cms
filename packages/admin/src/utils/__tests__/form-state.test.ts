import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { initialFormState } from '../form-state'

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

describe('initialFormState', () => {
  it('includes relation fields, from the source or their empty default', () => {
    // MUTATION: keep leaving paragraph and many-to-many fields out (before
    // #55). The taxonomy form then cannot show or edit them, although the
    // edit read now returns them.
    const form = initialFormState(fields, {
      name: 'Tag', parent: 'p-1', blocks: [{ title: 'b' }], hero: { title: 'h' }, related: ['t-2'],
    })
    expect(form).toMatchObject({ blocks: [{ title: 'b' }], hero: { title: 'h' }, related: ['t-2'] })

    // Empty defaults follow cardinality: a list for "many", null for "one".
    expect(initialFormState(fields)).toEqual({
      name: '', parent: null, blocks: [], hero: null, related: [],
    })
  })

  it('leaves programmatic fields out: they are computed and never saved', () => {
    // MUTATION: put programmatic fields into the form. Save would then send a
    // computed value back to the api.
    expect(initialFormState(fields, { name: 'Tag', computed: 'x' })).not.toHaveProperty('computed')
  })
})
