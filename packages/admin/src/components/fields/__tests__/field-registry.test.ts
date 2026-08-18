import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ParsedField, ParsedParagraphType } from '@bobbykim/manguito-cms-core'
import { componentFor, fieldExtraProps, getParagraphForm, clearParagraphFormCache } from '../field-registry'
import { useSchemaStore } from '../../../stores/schema'
import ParagraphEmbed from '../ParagraphEmbed.vue'

// A paragraph type holding a paragraph field of its own — the one level of
// nesting ADR core/0005 permits. The nested ParagraphEmbed cannot render its
// fields without a `formComponent`, and nothing outside this factory supplies one.

function paragraphField(name: string, ref: string): ParsedField {
  return {
    name,
    label: name,
    field_type: 'paragraph',
    required: false,
    nullable: true,
    order: 1,
    validation: { required: false },
    db_column: null,
    ui_component: { component: 'paragraph-embed', ref, rel: 'one-to-many' },
  }
}

function textField(name: string): ParsedField {
  return {
    name,
    label: name,
    field_type: 'text/plain',
    required: false,
    nullable: true,
    order: 0,
    validation: { required: false },
    db_column: { column_name: name, column_type: 'varchar', nullable: true },
    ui_component: { component: 'text-input' },
  }
}

const INNER: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--link_item',
  label: 'Link Item',
  source_file: 't.json',
  system_fields: [],
  fields: [textField('link_item_url'), textField('link_item_text')],
  db: { table_name: 'paragraph_link_item' },
}

const OUTER: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--card_image_link',
  label: 'Card',
  source_file: 't.json',
  system_fields: [],
  fields: [
    textField('card_image_link_title'),
    paragraphField('card_image_link_link', 'paragraph--link_item'),
  ],
  db: { table_name: 'paragraph_card_image_link' },
}

beforeEach(() => {
  setActivePinia(createPinia())
  clearParagraphFormCache()
  const store = useSchemaStore()
  store.paragraphTypes = {
    'paragraph--card_image_link': OUTER,
    'paragraph--link_item': INNER,
  }
})

describe('componentFor', () => {
  it('maps a paragraph field to ParagraphEmbed', () => {
    expect(componentFor(paragraphField('x', 'paragraph--link_item'))).toBe(ParagraphEmbed)
  })
})

describe('fieldExtraProps', () => {
  it('supplies a formComponent for a paragraph field', () => {
    const extra = fieldExtraProps(paragraphField('x', 'paragraph--link_item'))
    expect(extra['formComponent']).toBeDefined()
  })

  it('supplies nothing for a non-paragraph field', () => {
    expect(fieldExtraProps(textField('title'))).toEqual({})
  })
})

describe('getParagraphForm — nested paragraphs', () => {
  it('renders the nested paragraph field with a formComponent, not an empty block', () => {
    const OuterForm = getParagraphForm('paragraph--card_image_link')

    const wrapper = mount(OuterForm, {
      props: {
        modelValue: {
          card_image_link_title: 'A card',
          // One existing nested item — ParagraphEmbed only renders a body for
          // items that exist.
          card_image_link_link: [{ link_item_url: 'https://example.com', order: 0 }],
        },
      },
    })

    const nested = wrapper.findComponent(ParagraphEmbed)
    expect(nested.exists()).toBe(true)

    // The regression: without a formComponent the nested embed renders its item
    // header and an empty body, so the block appears with no editable fields.
    expect(nested.props('formComponent')).toBeTruthy()

    // Proof it actually rendered the inner form: the nested type's own inputs.
    const inputs = nested.findAll('input')
    expect(inputs.length).toBeGreaterThan(0)
    expect(wrapper.html()).toContain('link_item_url')
  })

  it('memoises the form per paragraph type', () => {
    expect(getParagraphForm('paragraph--link_item')).toBe(getParagraphForm('paragraph--link_item'))
  })

  it('renders a placeholder when the paragraph type is unknown', () => {
    const Form = getParagraphForm('paragraph--missing')
    const wrapper = mount(Form, { props: { modelValue: {} } })
    expect(wrapper.text()).toContain('Unknown paragraph type')
  })
})
