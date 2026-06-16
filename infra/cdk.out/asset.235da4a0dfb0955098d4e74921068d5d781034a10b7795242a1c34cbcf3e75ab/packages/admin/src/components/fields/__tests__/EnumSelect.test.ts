import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import EnumSelect from '../EnumSelect.vue'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'status',
    label: 'Status',
    field_type: 'enum',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false, allowed_values: ['draft', 'published', 'archived'] },
    db_column: { column_name: 'status', column_type: 'varchar', nullable: true },
    ui_component: { component: 'select', options: ['draft', 'published', 'archived'] },
    ...overrides,
  }
}

describe('EnumSelect', () => {
  it('renders an option for each allowed_value', () => {
    const wrapper = mount(EnumSelect, {
      props: { field: makeField(), modelValue: '' },
    })
    const options = wrapper.findAll('option').map(o => o.text())
    expect(options).toContain('draft')
    expect(options).toContain('published')
    expect(options).toContain('archived')
  })

  it('emits the selected value on change', async () => {
    const wrapper = mount(EnumSelect, {
      props: { field: makeField(), modelValue: '' },
    })
    await wrapper.find('select').setValue('published')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1]).toEqual(['published'])
  })

  it('shows "No options available" when allowed_values is empty', () => {
    const wrapper = mount(EnumSelect, {
      props: {
        field: makeField({
          validation: { required: false, allowed_values: [] },
          ui_component: { component: 'select', options: [] },
        }),
        modelValue: '',
      },
    })
    expect(wrapper.text()).toContain('No options available')
  })
})
