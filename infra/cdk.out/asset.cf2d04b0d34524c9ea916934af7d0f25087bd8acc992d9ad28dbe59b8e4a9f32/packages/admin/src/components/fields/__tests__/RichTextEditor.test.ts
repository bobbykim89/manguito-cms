import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import RichTextEditor from '../RichTextEditor.vue'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'body',
    label: 'Body',
    field_type: 'text/rich',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false },
    db_column: { column_name: 'body', column_type: 'text', nullable: true },
    ui_component: { component: 'rich-text-editor' },
    ...overrides,
  }
}

describe('RichTextEditor', () => {
  it('mounts without error', () => {
    expect(() =>
      mount(RichTextEditor, { props: { field: makeField(), modelValue: '' } })
    ).not.toThrow()
  })

  it('displays the error prop when set', () => {
    const wrapper = mount(RichTextEditor, {
      props: { field: makeField(), modelValue: '', error: 'Content is required' },
    })
    expect(wrapper.text()).toContain('Content is required')
  })

  it('toolbar buttons have disabled attribute when disabled prop is true', () => {
    const wrapper = mount(RichTextEditor, {
      props: { field: makeField(), modelValue: '', disabled: true },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach(btn => {
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })
})
