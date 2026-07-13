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
})
