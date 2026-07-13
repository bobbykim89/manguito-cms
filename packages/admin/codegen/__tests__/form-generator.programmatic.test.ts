import { describe, it, expect } from 'vitest'
import { generateFormComponent } from '../form-generator'
import type { ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'

const TAXO: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--tag',
  label: 'Tag',
  source_file: 'x.json',
  system_fields: [],
  fields: [
    { name: 'label_field', label: 'Label', field_type: 'text/plain', required: true, nullable: false, order: 0, validation: { required: true }, db_column: { column_name: 'label_field', column_type: 'varchar', nullable: false }, ui_component: { component: 'text-input' } },
    { name: 'computed_one', label: 'Computed One', field_type: 'programmatic', required: false, nullable: true, order: 1, validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' } },
  ],
  db: { table_name: 'taxonomy_tag' },
  api: { collection_path: '/api/taxonomy/tag', item_path: '/api/taxonomy/tag/:id' },
}

describe('form codegen for programmatic fields', () => {
  it('renders a ComputedDisplay with no value or update bindings', () => {
    const out = generateFormComponent(TAXO)
    expect(out).toContain('import ComputedDisplay from')
    expect(out).toContain('<ComputedDisplay')
    // No two-way binding for a computed field:
    const block = out.slice(out.indexOf('<ComputedDisplay'))
    expect(block).not.toContain(':modelValue="modelValue.computed_one"')
    expect(block).not.toContain("@update:modelValue=\"update('computed_one'")
  })
})
