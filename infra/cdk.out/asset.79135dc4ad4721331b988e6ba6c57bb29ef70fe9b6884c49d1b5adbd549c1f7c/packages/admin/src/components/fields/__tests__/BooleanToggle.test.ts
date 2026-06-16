import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import BooleanToggle from '../BooleanToggle.vue'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'is_active',
    label: 'Is Active',
    field_type: 'boolean',
    required: false,
    nullable: false,
    order: 0,
    validation: { required: false },
    db_column: { column_name: 'is_active', column_type: 'boolean', nullable: false },
    ui_component: { component: 'checkbox' },
    ...overrides,
  }
}

describe('BooleanToggle', () => {
  it('emits true when toggled from off to on', async () => {
    const wrapper = mount(BooleanToggle, {
      props: { field: makeField(), modelValue: false },
    })
    await wrapper.find('button[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })

  it('emits false when toggled from on to off', async () => {
    const wrapper = mount(BooleanToggle, {
      props: { field: makeField(), modelValue: true },
    })
    await wrapper.find('button[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })
})
