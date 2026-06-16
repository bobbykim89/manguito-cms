import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import DatePicker from '../DatePicker.vue'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'published_at',
    label: 'Published At',
    field_type: 'date',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false },
    db_column: { column_name: 'published_at', column_type: 'timestamp', nullable: true },
    ui_component: { component: 'date-picker' },
    ...overrides,
  }
}

describe('DatePicker', () => {
  it('emits an ISO string on change', async () => {
    const wrapper = mount(DatePicker, {
      props: { field: makeField(), modelValue: '' },
    })
    await wrapper.find('input').setValue('2024-06-15T10:30')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1]).toEqual(['2024-06-15T10:30:00.000Z'])
  })

  it('applies the disabled prop to the input', () => {
    const wrapper = mount(DatePicker, {
      props: { field: makeField(), modelValue: '', disabled: true },
    })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  })
})
