import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

  it('sizes the nested .ProseMirror element itself, not just the outer wrapper, so clicks in empty space focus the editor', async () => {
    const wrapper = mount(RichTextEditor, { props: { field: makeField(), modelValue: '' } })
    await flushPromises()
    const contentWrapper = wrapper.find('.ProseMirror').element.parentElement!
    expect(Array.from(contentWrapper.classList)).toContain('[&_.ProseMirror]:min-h-32')
    expect(Array.from(contentWrapper.classList)).toContain('[&_.ProseMirror]:cursor-text')
  })

  it('link button toggles the link popover, and Cancel closes it', async () => {
    const wrapper = mount(RichTextEditor, { props: { field: makeField(), modelValue: '' } })
    const linkButton = wrapper.findAll('button').find(b => b.text() === 'Link')
    expect(linkButton).toBeTruthy()

    expect(wrapper.text()).not.toContain('CSS class')

    await linkButton!.trigger('click')
    expect(wrapper.text()).toContain('CSS class')
    expect(wrapper.find('input[placeholder="https://example.com"]').exists()).toBe(true)
    expect(wrapper.find('select').exists()).toBe(true)

    const cancelButton = wrapper.findAll('button').find(b => b.text() === 'Cancel')
    await cancelButton!.trigger('click')
    expect(wrapper.text()).not.toContain('CSS class')
  })

  it('link button is disabled (no popover) when the field is disabled', async () => {
    const wrapper = mount(RichTextEditor, {
      props: { field: makeField(), modelValue: '', disabled: true },
    })
    const linkButton = wrapper.findAll('button').find(b => b.text() === 'Link')
    expect(linkButton!.attributes('disabled')).toBeDefined()

    await linkButton!.trigger('click')
    expect(wrapper.text()).not.toContain('CSS class')
  })
})
