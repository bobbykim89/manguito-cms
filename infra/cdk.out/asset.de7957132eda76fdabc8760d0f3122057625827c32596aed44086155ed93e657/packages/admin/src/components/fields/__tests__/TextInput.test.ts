import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import TextInput from '../TextInput.vue'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'test_field',
    label: 'Test Field',
    field_type: 'text/plain',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false },
    db_column: { column_name: 'test_field', column_type: 'varchar', nullable: true },
    ui_component: { component: 'text-input' },
    ...overrides,
  }
}

describe('TextInput', () => {
  it('renders an input element', () => {
    const wrapper = mount(TextInput, {
      props: { field: makeField(), modelValue: '' },
    })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('typing emits update:modelValue with the typed value', async () => {
    const wrapper = mount(TextInput, {
      props: { field: makeField(), modelValue: '' },
    })
    const input = wrapper.find('input')
    await input.setValue('hello world')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1]).toEqual(['hello world'])
  })

  it('renders inline error text when error prop is set', () => {
    const wrapper = mount(TextInput, {
      props: { field: makeField(), modelValue: '', error: 'Required field' },
    })
    expect(wrapper.text()).toContain('Required field')
  })

  it('does not render error text when error prop is not set', () => {
    const wrapper = mount(TextInput, {
      props: { field: makeField(), modelValue: '' },
    })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('input has disabled attribute when disabled prop is true', () => {
    const wrapper = mount(TextInput, {
      props: { field: makeField(), modelValue: '', disabled: true },
    })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  })

  it('slug field formats "My Blog Post" to "my-blog-post"', async () => {
    const wrapper = mount(TextInput, {
      props: {
        field: makeField({ name: 'post_slug' }),
        modelValue: '',
      },
    })
    await wrapper.find('input').setValue('My Blog Post')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1]).toEqual(['my-blog-post'])
  })
})
