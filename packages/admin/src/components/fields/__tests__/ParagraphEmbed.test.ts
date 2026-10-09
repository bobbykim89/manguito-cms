import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import ParagraphEmbed from '../ParagraphEmbed.vue'

// Stands in for a generated paragraph form: one button that emits a value.
const StubForm = defineComponent({
  props: { modelValue: { type: Object, default: null }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup(_, { emit }) {
    return () => h('button', { class: 'stub-form', onClick: () => emit('update:modelValue', { url: 'edited' }) }, 'stub')
  },
})

const field = (rel: 'one-to-one' | 'one-to-many'): ParsedField =>
  ({
    name: 'link', label: 'Link', field_type: 'paragraph', required: false, nullable: true, order: 0,
    validation: { required: false }, db_column: null,
    ui_component: { component: 'paragraph-embed', ref: 'paragraph--link', rel },
  }) as ParsedField

const mountWith = (rel: 'one-to-one' | 'one-to-many', modelValue: unknown) =>
  mount(ParagraphEmbed, { props: { field: field(rel), modelValue, formComponent: StubForm } })

describe('ParagraphEmbed, one-to-one', () => {
  it('when empty, Add emits a single object, not a list', async () => {
    // MUTATION: render list mode for every rel. Add then emits [{ order: 0 }].
    const w = mountWith('one-to-one', null)
    await w.get('button').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([{}])
  })

  it('edits emit the item object', async () => {
    // MUTATION: wrap single edits as [value].
    const w = mountWith('one-to-one', { url: 'a' })
    await w.get('.stub-form').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([{ url: 'edited' }])
  })

  it('Remove emits null and offers no second item', async () => {
    // MUTATION: keep the list's Add button visible in single mode.
    const w = mountWith('one-to-one', { url: 'a' })
    expect(w.findAll('button').filter((b) => b.text().includes('Add'))).toHaveLength(0)
    await w.get('[aria-label="Remove Link"]').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([null])
  })

  it('treats a legacy array value as empty, showing Add', () => {
    // MUTATION: index into an array value. A stale list renders as an item.
    const w = mountWith('one-to-one', [{ url: 'a' }])
    expect(w.findAll('.stub-form')).toHaveLength(0)
    expect(w.text()).toContain('Add Link')
  })
})

describe('ParagraphEmbed, one-to-many (unchanged)', () => {
  it('Add appends an ordered item to the list', async () => {
    // MUTATION: route one-to-many into single mode.
    const w = mountWith('one-to-many', [])
    await w.get('button').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([[{ order: 0 }]])
  })
})
