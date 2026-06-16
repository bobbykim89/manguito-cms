import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

  it('input is disabled and counter shows X / Y when max_items is reached', async () => {
    server.use(
      http.get(`${ADMIN}/api/content/content--user/:id`, ({ params }) =>
        HttpResponse.json({ ok: true, data: { id: params['id'], title: `User ${params['id']}` } })
      )
    )
    const field = makeField({
      validation: { required: false, max_items: 2 },
      ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'many-to-many' },
    })
    const wrapper = mountComponent(field, ['u1', 'u2'])
    await flushPromises()

    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('2 / 2')
  })
})
