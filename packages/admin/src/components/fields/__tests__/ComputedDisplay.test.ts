import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ComputedDisplay from '../ComputedDisplay.vue'

describe('ComputedDisplay', () => {
  it('shows the label and a computed-at-read-time note, and emits nothing', () => {
    const wrapper = mount(ComputedDisplay, { props: { field: { label: 'My Summary' } } })
    expect(wrapper.text()).toContain('My Summary')
    expect(wrapper.text()).toContain('Computed at read time')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted()).toEqual({})
  })

  // The form renders every field with the same bindings; ComputedDisplay must
  // stay inert as a drop-in — no input, no emitted update, and none of the
  // unused bindings leaking onto the rendered element (inheritAttrs: false).
  it('ignores the form field bindings it does not use', () => {
    const wrapper = mount(ComputedDisplay, {
      props: { field: { label: 'My Summary' } },
      attrs: {
        modelValue: 'some value',
        disabled: true,
        error: 'nope',
        'onUpdate:modelValue': () => {},
      },
    })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted()['update:modelValue']).toBeUndefined()
    const root = wrapper.element as HTMLElement
    expect(root.getAttribute('modelvalue')).toBeNull()
    expect(root.getAttribute('disabled')).toBeNull()
    expect(root.getAttribute('error')).toBeNull()
  })
})
