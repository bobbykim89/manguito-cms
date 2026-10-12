import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ParsedField, ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'
import { useSchemaStore } from '../../../stores/schema'
import { useAuthStore } from '../../../stores/auth'
import TaxonomyFormView from '../TaxonomyFormView.vue'
import ParagraphEmbed from '../../../components/fields/ParagraphEmbed.vue'
import ReferenceSelect from '../../../components/fields/ReferenceSelect.vue'
import MediaUpload from '../../../components/fields/MediaUpload.vue'

// Create mode: no :id param, so the form renders from defaults with no fetch.
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { type: 'taxonomy--tag' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

const base = { required: false, nullable: true, order: 0, validation: { required: false } }

const tagType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--tag',
  label: 'Tag',
  source_file: '',
  system_fields: [],
  fields: [
    { ...base, name: 'name', label: 'Name', field_type: 'text/plain',
      db_column: { column_name: 'name', column_type: 'varchar', nullable: true }, ui_component: { component: 'text-input' } },
    { ...base, name: 'icon', label: 'Icon', field_type: 'image',
      validation: { required: false, allowed_mime_types: ['image/png'] },
      db_column: { column_name: 'icon', column_type: 'uuid', nullable: true },
      ui_component: { component: 'file-upload', accepted_mime_types: ['image/*'] } },
    { ...base, name: 'parent', label: 'Parent', field_type: 'reference',
      db_column: { column_name: 'parent', column_type: 'uuid', nullable: true },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--tag', rel: 'one-to-one' } },
    { ...base, name: 'related', label: 'Related', field_type: 'reference',
      db_column: { column_name: '', column_type: 'uuid', nullable: true,
        junction: { table_name: 'junction_taxonomy_tag_related', left_column: 'left_id', right_column: 'right_id', right_table: 'taxonomy_tag', order_column: false } },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--tag', rel: 'many-to-many' } },
    { ...base, name: 'blurb', label: 'Blurb', field_type: 'paragraph', db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--blurb', rel: 'one-to-one' } },
  ] as unknown as ParsedField[],
  db: { table_name: 'taxonomy_tag', junction_tables: [] },
} as unknown as ParsedTaxonomyType

let pinia: ReturnType<typeof createPinia>

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  useSchemaStore().setSchema(tagType)
})

describe('TaxonomyFormView', () => {
  it('renders relation and media fields with their real editors, not a text box', async () => {
    // MUTATION: keep the view's own flat component map (before #55). Every
    // paragraph, reference and media field then falls back to TextInput.
    const w = mount(TaxonomyFormView, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(w.findComponent(MediaUpload).exists()).toBe(true)
    expect(w.findAllComponents(ReferenceSelect)).toHaveLength(2)
    expect(w.findComponent(ParagraphEmbed).exists()).toBe(true)
  })

  it('shows VALIDATION_ERROR details from a save: on the field, or in the banner for a paragraph path', async () => {
    // MUTATION: merge details only for PUBLISH_VALIDATION_ERROR (before #57).
    // The editor then sees only "Some values are not valid", with no field.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some values are not valid',
          details: [
            { field: 'name', message: 'name can be at most 255 characters.' },
            { field: 'blurb.text', message: 'blurb.text is required.' },
          ],
        },
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    ))
    // An editor allowed to create terms, so the Save button renders.
    useSchemaStore().setRoles([{ name: 'editor', label: 'Editor', hierarchy_level: 1, permissions: ['taxonomy:create'] }] as never)
    useAuthStore().setUser({ id: 'u1', email: 'e@example.com', role: 'editor' })
    const w = mount(TaxonomyFormView, { global: { plugins: [pinia] } })
    await flushPromises()
    const save = w.findAll('button').find((b) => b.text() === 'Save')!
    await save.trigger('click')
    await flushPromises()

    // The field's own error, and the form's banner, are both alerts.
    const alerts = w.findAll('[role="alert"]').map((a) => a.text())
    expect(alerts).toContain('name can be at most 255 characters.')
    expect(alerts).toContain('Some values are not valid blurb.text is required.')
  })

  it('gives the paragraph editor its paragraph form', async () => {
    // MUTATION: render with componentFor but drop `v-bind="fieldExtraProps(field)"`.
    // ParagraphEmbed then has no formComponent and cannot render its item.
    const w = mount(TaxonomyFormView, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(w.findComponent(ParagraphEmbed).props('formComponent')).toBeTruthy()
  })
})
