import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import NumberInput from '../NumberInput.vue'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'count',
    label: 'Count',
    field_type: 'integer',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false },
    db_column: { column_name: 'count', column_type: 'integer', nullable: true },
    ui_component: { component: 'number-input', step: 1 },
    ...overrides,
  }
}

describe('NumberInput', () => {
  it('emits numeric value on change', async () => {
    const wrapper = mount(NumberInput, {
      props: { field: makeField(), modelValue: null },
    })
    const input = wrapper.find('input')
    await input.setValue('42')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1]).toEqual([42])
  })

  it('integer field has step attribute of 1', () => {
    const wrapper = mount(NumberInput, {
      props: { field: makeField({ field_type: 'integer' }), modelValue: null },
    })
    expect(wrapper.find('input').attributes('step')).toBe('1')
  })

  it('float field has step attribute of 0.01', () => {
    const wrapper = mount(NumberInput, {
      props: {
        field: makeField({
          field_type: 'float',
          db_column: { column_name: 'price', column_type: 'decimal', nullable: true },
          ui_component: { component: 'number-input', step: 0.01 },
        }),
        modelValue: null,
      },
    })
    expect(wrapper.find('input').attributes('step')).toBe('0.01')
  })

  it('applies min and max from field.validation to input attributes', () => {
    const wrapper = mount(NumberInput, {
      props: {
        field: makeField({ validation: { required: false, min: 0, max: 100 } }),
        modelValue: null,
      },
    })
    const input = wrapper.find('input')
    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBe('100')
  })
})
