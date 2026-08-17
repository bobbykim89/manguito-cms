// Maps a parsed field to the component that edits it, and builds the paragraph
// sub-forms those components need.
//
// Lives apart from ContentFormView so the paragraph-form factory can be tested on
// its own: it is the piece that has to thread `formComponent` down through nested
// paragraphs, and that wiring is invisible from the outside until it breaks.
import { computed, defineComponent, h, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { useSchemaStore } from '../../stores/schema'
import TextInput from './TextInput.vue'
import RichTextEditor from './RichTextEditor.vue'
import NumberInput from './NumberInput.vue'
import BooleanToggle from './BooleanToggle.vue'
import DatePicker from './DatePicker.vue'
import MediaUpload from './MediaUpload.vue'
import EnumSelect from './EnumSelect.vue'
import ReferenceSelect from './ReferenceSelect.vue'
import ParagraphEmbed from './ParagraphEmbed.vue'
import ComputedDisplay from './ComputedDisplay.vue'

export const FIELD_COMP: Record<string, Component> = {
  'text/plain': markRaw(TextInput),
  'text/rich': markRaw(RichTextEditor),
  integer: markRaw(NumberInput),
  float: markRaw(NumberInput),
  boolean: markRaw(BooleanToggle),
  date: markRaw(DatePicker),
  image: markRaw(MediaUpload),
  video: markRaw(MediaUpload),
  file: markRaw(MediaUpload),
  enum: markRaw(EnumSelect),
  reference: markRaw(ReferenceSelect),
  paragraph: markRaw(ParagraphEmbed),
  programmatic: markRaw(ComputedDisplay),
}

export function componentFor(field: ParsedField): Component {
  return FIELD_COMP[field.field_type] ?? FIELD_COMP['text/plain']!
}

// Props a field's component needs beyond the common set. ParagraphEmbed cannot
// render anything without a `formComponent`, so every paragraph field — top level
// or nested inside another paragraph — has to be given one here.
export function fieldExtraProps(field: ParsedField): Record<string, unknown> {
  if (field.ui_component.component === 'paragraph-embed') {
    return { formComponent: getParagraphForm(field.ui_component.ref) }
  }
  return {}
}

const paragraphFormCache = new Map<string, Component>()

/** Reset the memoised paragraph forms. Tests only — the app builds them once. */
export function clearParagraphFormCache(): void {
  paragraphFormCache.clear()
}

// Builds a paragraph type's edit form as a render function, so no runtime template
// compiler is needed. Fields are read from the schema store at render time.
export function getParagraphForm(schemaName: string): Component {
  const cached = paragraphFormCache.get(schemaName)
  if (cached) return cached

  const comp = markRaw(
    defineComponent({
      name: `ParagraphForm_${schemaName}`,
      props: {
        modelValue: {
          type: Object as PropType<Record<string, unknown>>,
          default: () => ({}),
        },
        disabled: { type: Boolean, default: false },
      },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        const store = useSchemaStore()
        const schema = computed(() => store.paragraphTypes[schemaName])

        function update(name: string, val: unknown) {
          emit('update:modelValue', { ...props.modelValue, [name]: val })
        }

        return () => {
          if (!schema.value) {
            return h('div', { class: 'text-sm text-gray-400' }, 'Unknown paragraph type')
          }
          return h(
            'div',
            { class: 'space-y-3' },
            schema.value.fields.map((field) => {
              const c = componentFor(field)
              return h(c as Parameters<typeof h>[0], {
                key: field.name,
                field,
                modelValue: (props.modelValue ?? {})[field.name],
                disabled: props.disabled,
                // A paragraph type may hold a paragraph field of its own (one
                // level, per ADR core/0005). Without these the nested
                // ParagraphEmbed has no formComponent and renders an item header
                // with an empty body — the block adds but has no fields.
                // getParagraphForm recurses here; the cache above and the parser's
                // one-level cap keep that finite.
                ...fieldExtraProps(field),
                'onUpdate:modelValue': (v: unknown) => update(field.name, v),
              })
            })
          )
        }
      },
    })
  )

  paragraphFormCache.set(schemaName, comp)
  return comp
}
