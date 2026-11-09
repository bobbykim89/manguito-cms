import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import type { ParsedField, ParsedContentType } from '@bobbykim/manguito-cms-core'
import { server } from '../../../test-utils/server'
import { useSchemaStore } from '../../../stores/schema'
import ReferenceSelect from '../ReferenceSelect.vue'

// useApiClient calls useRouter() — stub it so component setup doesn't throw.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const ADMIN = '/admin'

const userContentType: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--user',
  label: 'User',
  source_file: '',
  only_one: false,
  default_base_path: 'users',
  system_fields: [],
  fields: [
    {
      name: 'title',
      label: 'Title',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  ui: { tabs: [{ name: 'main', label: 'Main', fields: ['title'] }] },
  db: { table_name: 'content_user', junction_tables: [] },
  api: {
    default_base_path: 'users',
    http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    collection_path: '/api/user',
    item_path: '/api/user/:slug',
  },
}

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'author',
    label: 'Author',
    field_type: 'reference',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false },
    db_column: { column_name: 'author', column_type: 'uuid', nullable: true },
    ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'one-to-one' },
    ...overrides,
  }
}

// The admin list endpoint as chip labels use it: rows for the ids asked for
// with filter[id], in any order, and nothing for an id that no longer exists.
// Every request URL lands in `requests`.
function serveLabels(names: Record<string, string>, requests: URL[] = []) {
  server.use(
    http.get(`${ADMIN}/api/content/content--user`, ({ request }) => {
      const url = new URL(request.url)
      requests.push(url)
      const ids = url.searchParams.getAll('filter[id]')
      const data = ids.filter((id) => names[id] !== undefined).reverse().map((id) => ({ id, title: names[id] }))
      return HttpResponse.json({ ok: true, data, meta: { total: data.length, page: 1, per_page: 100, total_pages: 1 } })
    })
  )
  return requests
}

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  const schemaStore = useSchemaStore()
  schemaStore.setSchema(userContentType)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function mountComponent(field: ParsedField, modelValue: unknown = null) {
  return mount(ReferenceSelect, {
    global: { plugins: [pinia] },
    props: { field, modelValue },
  })
}

describe('ReferenceSelect', () => {
  it('does not show dropdown when fewer than 2 chars are typed', async () => {
    const wrapper = mountComponent(makeField())
    await wrapper.find('input').setValue('a')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('shows dropdown with result items when MSW returns results', async () => {
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, () =>
        HttpResponse.json({ ok: true, data: [{ id: 'u1', title: 'Alice' }] })
      )
    )
    const wrapper = mountComponent(makeField())
    await wrapper.find('input').setValue('al')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Alice')
  })

  it('shows "No results found" when MSW returns an empty array', async () => {
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, () =>
        HttpResponse.json({ ok: true, data: [] })
      )
    )
    const wrapper = mountComponent(makeField())
    await wrapper.find('input').setValue('xy')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.text()).toContain('No results found')
  })

  it('selecting an item emits update:modelValue with the selected id', async () => {
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, () =>
        HttpResponse.json({ ok: true, data: [{ id: 'u1', title: 'Alice' }] })
      )
    )
    const wrapper = mountComponent(makeField())
    await wrapper.find('input').setValue('al')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()

    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['u1'])
  })

  it('many-to-many: selecting multiple items shows chips for each', async () => {
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, () =>
        HttpResponse.json({
          ok: true,
          data: [
            { id: 'u1', title: 'Alice' },
            { id: 'u2', title: 'Bob' },
          ],
        })
      )
    )
    const field = makeField({
      ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'many-to-many' },
    })
    const wrapper = mountComponent(field)

    // Select first item (Alice)
    await wrapper.find('input').setValue('al')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    // Simulate parent v-model update so selectedIds reflects the first pick
    await wrapper.setProps({ modelValue: ['u1'] })
    await wrapper.vm.$nextTick()

    // Select second item (Bob — index 1 since MSW returns both)
    await wrapper.find('input').setValue('bo')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    await wrapper.findAll('[role="option"]')[1]!.trigger('click')
    await wrapper.vm.$nextTick()

    const emitted = wrapper.emitted('update:modelValue')!
    const lastEmit = emitted[emitted.length - 1]![0] as string[]
    expect(lastEmit).toContain('u1')
    expect(lastEmit).toContain('u2')
  })

  describe('reordering many-to-many chips (#57)', () => {
    const NAMES: Record<string, string> = { u1: 'Alice', u2: 'Bob', u3: 'Cara' }
    const manyField = () =>
      makeField({ ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'many-to-many' } })

    // Chip labels load on mount, from the list endpoint.
    async function mountWithChips(ids: string[], props: { disabled?: boolean } = {}) {
      serveLabels(NAMES)
      const wrapper = mount(ReferenceSelect, {
        global: { plugins: [pinia] },
        props: { field: manyField(), modelValue: ids, ...props },
      })
      await flushPromises()
      return wrapper
    }
    const button = (w: Awaited<ReturnType<typeof mountWithChips>>, label: string) =>
      w.find(`button[aria-label="${label}"]`)

    it('moves a chip earlier or later, emitting the list in its new order', async () => {
      // MUTATION: emit selectedIds unchanged from moveChip, or move by the wrong
      // step. The editor's reorder is then lost or lands in the wrong place.
      const w = await mountWithChips(['u1', 'u2', 'u3'])
      await button(w, 'Move Bob earlier').trigger('click')
      await button(w, 'Move Bob later').trigger('click')
      expect(w.emitted('update:modelValue')).toEqual([[['u2', 'u1', 'u3']], [['u1', 'u3', 'u2']]])
    })

    it('offers no move past either end, and none for a single chip', async () => {
      // MUTATION: render both buttons on every chip. The first chip then has a
      // "Move earlier" that does nothing.
      const w = await mountWithChips(['u1', 'u2', 'u3'])
      expect(button(w, 'Move Alice earlier').exists()).toBe(false)
      expect(button(w, 'Move Alice later').exists()).toBe(true)
      expect(button(w, 'Move Cara later').exists()).toBe(false)
      const single = await mountWithChips(['u1'])
      expect(single.findAll('button[aria-label^="Move "]')).toHaveLength(0)
    })

    it('keeps focus on the moved chip, on its other button once it reaches an end', async () => {
      // MUTATION: drop the focus step in moveChip. The pressed button moves
      // with its chip (or disappears at an end), focus falls to <body>, and a
      // keyboard user must tab back from the top for every step.
      serveLabels(NAMES)
      // A parent with a real v-model, so a move re-renders the list.
      const Parent = defineComponent({
        setup() {
          const ids = ref(['u1', 'u2', 'u3'])
          return () => h(ReferenceSelect, { field: manyField(), modelValue: ids.value, 'onUpdate:modelValue': (v: unknown) => { ids.value = v as string[] } })
        },
      })
      const w = mount(Parent, { global: { plugins: [pinia] }, attachTo: document.body })
      await flushPromises()
      const press = async (label: string) => {
        const b = w.get(`button[aria-label="${label}"]`)
        ;(b.element as HTMLElement).focus()
        await b.trigger('click')
        await flushPromises()
      }
      const focused = () => document.activeElement?.getAttribute('aria-label')

      await press('Move Cara earlier') // Cara is now in the middle
      expect(focused()).toBe('Move Cara earlier')
      await press('Move Cara earlier') // Cara is now first: no earlier button
      expect(focused()).toBe('Move Cara later')
      w.unmount()
    })

    it('shows a repeated id once, as the API stores it, and moves the de-duplicated list', async () => {
      // MUTATION: render modelValue as sent. Links saved before the API
      // de-duplicated read as [u1, u1, u2]: two chips with the same key, and
      // two "Move Alice later" buttons a screen reader cannot tell apart.
      const w = await mountWithChips(['u1', 'u1', 'u2'])
      expect(w.findAll('button[aria-label^="Remove "]')).toHaveLength(2)
      await button(w, 'Move Bob earlier').trigger('click')
      expect(w.emitted('update:modelValue')).toEqual([[['u2', 'u1']]])
    })

    it('disables the move buttons with the field', async () => {
      // MUTATION: leave :disabled off the move buttons. A read-only form (no
      // edit permission) then still lets an editor reorder.
      const w = await mountWithChips(['u1', 'u2'], { disabled: true })
      expect(button(w, 'Move Alice later').attributes('disabled')).toBeDefined()
      expect(button(w, 'Move Bob earlier').attributes('disabled')).toBeDefined()
    })
  })

  it('input is disabled and counter shows X / Y when max_items is reached', async () => {
    serveLabels({ u1: 'User u1', u2: 'User u2' })
    const field = makeField({
      validation: { required: false, max_items: 2 },
      ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'many-to-many' },
    })
    const wrapper = mountComponent(field, ['u1', 'u2'])
    await flushPromises()

    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('2 / 2')
  })

  it('a deprecated one-to-many reference is a single picker and emits one id', async () => {
    // MUTATION: keep `isMulti = relType !== 'one-to-one'`. Selecting then emits
    // ['u1'], which the API now rejects with 422.
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, () =>
        HttpResponse.json({ ok: true, data: [{ id: 'u1', title: 'Alice' }] })
      )
    )
    const wrapper = mountComponent(
      makeField({ ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'one-to-many' } })
    )
    await wrapper.find('input').setValue('al')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['u1'])
  })

  describe('chip labels (#57)', () => {
    const manyField = (max_items?: number) =>
      makeField({
        validation: { required: false, ...(max_items !== undefined && { max_items }) },
        ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'many-to-many' },
      })
    const removeLabels = (w: ReturnType<typeof mountComponent>) =>
      w.findAll('button[aria-label^="Remove "]').map((b) => b.attributes('aria-label'))

    it('loads every chip label in one list request, with no item reads', async () => {
      // MUTATION: fetch each label from GET /:id, as before. Each chip then
      // loads its whole item (every paragraph and link) in its own request:
      // itemReads is 3 and the list is never asked.
      let itemReads = 0
      server.use(
        http.get(`${ADMIN}/api/content/content--user/:id`, () => {
          itemReads++
          return HttpResponse.json({ ok: true, data: { id: 'x', title: 'x' } })
        })
      )
      const requests = serveLabels({ u1: 'Alice', u2: 'Bob', u3: 'Cara' })
      const w = mountComponent(manyField(), ['u1', 'u2', 'u3'])
      await flushPromises()

      expect(itemReads).toBe(0)
      expect(requests).toHaveLength(1)
      expect(requests[0]!.searchParams.getAll('filter[id]')).toEqual(['u1', 'u2', 'u3'])
      expect(requests[0]!.searchParams.get('per_page')).toBe('3')
      // The response comes back in another order; chips keep the saved one.
      expect(removeLabels(w)).toEqual(['Remove Alice', 'Remove Bob', 'Remove Cara'])
    })

    it('labels an id the list does not return with the id itself', async () => {
      // MUTATION: leave a missing id without a label. Its chip then reads
      // "Remove undefined", or blank, instead of naming the deleted item's id.
      serveLabels({ u1: 'Alice' })
      const w = mountComponent(manyField(), ['u1', 'gone'])
      await flushPromises()
      expect(removeLabels(w)).toEqual(['Remove Alice', 'Remove gone'])
    })

    it('asks for at most 100 ids per request', async () => {
      // MUTATION: send every id in one request. With 101 ids, per_page=101 is
      // over the API's limit of 100, it answers 400, and no chip gets a label.
      const names = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`u${i}`, `User ${i}`]))
      const requests = serveLabels(names)
      const w = mountComponent(manyField(), Object.keys(names))
      await flushPromises()
      expect(requests.map((r) => r.searchParams.getAll('filter[id]').length)).toEqual([100, 1])
      expect(requests.map((r) => r.searchParams.get('per_page'))).toEqual(['100', '1'])
      expect(removeLabels(w)).toContain('Remove User 100')
    })

    it('a one-to-one reference loads its label from the list too', async () => {
      // MUTATION: keep the per-id read for a single id. The one chip then
      // loads its whole item.
      const requests = serveLabels({ u1: 'Alice' })
      const w = mountComponent(makeField(), 'u1')
      await flushPromises()
      expect(requests[0]!.searchParams.getAll('filter[id]')).toEqual(['u1'])
      expect(w.text()).toContain('Alice')
    })
  })

  it('searches with search=, the parameter the list endpoint reads', async () => {
    // MUTATION: send filters[title][like]=… as before. The API's filter parser
    // reads only filter[…] with gt/gte/lt/lte, so it ignores the parameter and
    // every search returns the first 10 items, whatever was typed.
    const requests: URL[] = []
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, ({ request }) => {
        requests.push(new URL(request.url))
        return HttpResponse.json({ ok: true, data: [{ id: 'u1', title: 'Alice' }] })
      })
    )
    const wrapper = mountComponent(makeField())
    await wrapper.find('input').setValue('ali')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.searchParams.get('search')).toBe('ali')
    expect(requests[0]!.searchParams.get('per_page')).toBe('10')
    expect([...requests[0]!.searchParams.keys()].filter((k) => k.startsWith('filter'))).toEqual([])
  })
})
