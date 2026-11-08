import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
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

describe('ParagraphEmbed, one-to-many reordering', () => {
  const three = () => [{ order: 0, url: 'a' }, { order: 1, url: 'b' }, { order: 2, url: 'c' }]
  const btn = (w: ReturnType<typeof mountWith>, label: string) => w.find(`button[aria-label="${label}"]`)

  it('moves an item earlier or later, renumbering order', async () => {
    // MUTATION: emit the list unchanged, or skip renumbering order.
    const w = mountWith('one-to-many', three())
    await btn(w, 'Move item 2 earlier').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([
      [{ order: 0, url: 'b' }, { order: 1, url: 'a' }, { order: 2, url: 'c' }],
    ])
    await btn(w, 'Move item 2 later').trigger('click')
    expect(w.emitted('update:modelValue')?.[1]).toEqual([
      [{ order: 0, url: 'a' }, { order: 1, url: 'c' }, { order: 2, url: 'b' }],
    ])
  })

  it('offers no move past either end', () => {
    // MUTATION: render both buttons on every item.
    const w = mountWith('one-to-many', three())
    expect(btn(w, 'Move item 1 earlier').exists()).toBe(false)
    expect(btn(w, 'Move item 1 later').exists()).toBe(true)
    expect(btn(w, 'Move item 3 later').exists()).toBe(false)
    const single = mountWith('one-to-many', [{ order: 0 }])
    expect(single.findAll('button[aria-label^="Move item"]')).toHaveLength(0)
  })

  it('keeps focus on the moved item, on its other button at an end', async () => {
    // MUTATION: drop the focus step in moveParagraph. Focus falls to <body>
    // after each move.
    const Parent = defineComponent({
      setup() {
        const items = ref<Record<string, unknown>[]>(three())
        return () => h(ParagraphEmbed, {
          field: field('one-to-many'), formComponent: StubForm, modelValue: items.value,
          'onUpdate:modelValue': (v: unknown) => { items.value = v as Record<string, unknown>[] },
        })
      },
    })
    const w = mount(Parent, { attachTo: document.body })
    const press = async (label: string) => {
      const b = w.get(`button[aria-label="${label}"]`)
      ;(b.element as HTMLElement).focus()
      await b.trigger('click')
      await flushPromises()
    }
    const focused = () => document.activeElement?.getAttribute('aria-label')
    await press('Move item 3 earlier')
    expect(focused()).toBe('Move item 2 earlier')
    await press('Move item 2 earlier')
    expect(focused()).toBe('Move item 1 later')
    await press('Move item 1 later')
    expect(focused()).toBe('Move item 2 later')
    await press('Move item 2 later') // last: no later button
    expect(focused()).toBe('Move item 3 earlier')
    w.unmount()
  })

  it('moves focus within its own list when items hold nested paragraph lists', async () => {
    // MUTATION: look the item and its button up with unscoped descendant
    // selectors. Item 0's nested list also has data-item-index="1", so focus
    // lands on a nested button instead of the outer item.
    const NestedForm = defineComponent({
      props: { modelValue: { type: Object, default: null }, disabled: Boolean },
      setup(p) {
        return () => (p.modelValue as { nested?: unknown[] } | null)?.nested
          ? h(ParagraphEmbed, { field: field('one-to-many'), modelValue: (p.modelValue as { nested: unknown[] }).nested, formComponent: StubForm })
          : h('span')
      },
    })
    const Parent = defineComponent({
      setup() {
        const items = ref<Record<string, unknown>[]>([
          { order: 0, nested: [{ order: 0 }, { order: 1 }, { order: 2 }] }, { order: 1 }, { order: 2 },
        ])
        return () => h(ParagraphEmbed, {
          field: field('one-to-many'), formComponent: NestedForm, modelValue: items.value,
          'onUpdate:modelValue': (v: unknown) => { items.value = v as Record<string, unknown>[] },
        })
      },
    })
    const w = mount(Parent, { attachTo: document.body })
    const outer = (i: number) => (w.element as HTMLElement).querySelector<HTMLElement>(`:scope > .mt-1 > [data-item-index="${i}"]`)!
    const b = outer(2).querySelector<HTMLElement>('[data-move="earlier"]')!
    b.focus()
    await b.click()
    await flushPromises()
    expect(document.activeElement?.closest('[data-item-index]')).toBe(outer(1))
    expect(document.activeElement?.getAttribute('data-move')).toBe('earlier')
    w.unmount()
  })

  // Captures its item's url on mount, as MediaUpload loads its preview and
  // ReferenceSelect its labels.
  const CaptureForm = defineComponent({
    props: { modelValue: { type: Object, default: null }, disabled: Boolean },
    setup(p) {
      const captured = (p.modelValue as { url?: string } | null)?.url ?? 'new'
      return () => h('span', { class: 'captured' }, captured)
    },
  })
  // A parent bound with v-model, as the form views are, over `items`.
  const mountBound = (items: Ref<Record<string, unknown>[]>) =>
    mount(defineComponent({
      setup() {
        return () => h(ParagraphEmbed, {
          field: field('one-to-many'), formComponent: CaptureForm, modelValue: items.value,
          'onUpdate:modelValue': (v: unknown) => { items.value = v as Record<string, unknown>[] },
        })
      },
    }))
  const shown = (w: ReturnType<typeof mountBound>) => w.findAll('.captured').map((c) => c.text())
  const click = async (w: ReturnType<typeof mountBound>, label: string) => {
    await w.get(`button[aria-label="${label}"]`).trigger('click')
    await flushPromises()
  }

  it("keeps each item's field state with the item through a move, a remove and an add", async () => {
    // MUTATION: key by index. Each position then keeps the child mounted for
    // the item that was there, showing the old item's captured url.
    const w = mountBound(ref(three()))
    await click(w, 'Move item 2 earlier')
    expect(shown(w)).toEqual(['b', 'a', 'c'])
    await click(w, 'Remove item 1')
    expect(shown(w)).toEqual(['a', 'c'])
    await click(w, 'Move item 1 later')
    expect(shown(w)).toEqual(['c', 'a'])
    await w.findAll('button').find((b) => b.text().includes('Add Link'))!.trigger('click')
    await flushPromises()
    expect(shown(w)).toEqual(['c', 'a', 'new'])
  })

  it('keys a list loaded from outside, so its items move', async () => {
    // MUTATION: never resync the keys from the model. A list loaded after
    // mount (an edit read) then has no keys to move, and the move does nothing.
    const items = ref<Record<string, unknown>[]>([])
    const w = mountBound(items)
    items.value = [{ order: 0, url: 'x' }, { order: 1, url: 'y' }]
    await flushPromises()
    await click(w, 'Move item 2 earlier')
    expect(shown(w)).toEqual(['y', 'x'])
  })

  it('hides the move buttons when disabled', () => {
    // MUTATION: render them regardless of disabled (Remove is already hidden when disabled).
    const w = mount(ParagraphEmbed, {
      props: { field: field('one-to-many'), modelValue: three(), formComponent: StubForm, disabled: true },
    })
    expect(w.findAll('button[aria-label^="Move item"]')).toHaveLength(0)
  })
})
