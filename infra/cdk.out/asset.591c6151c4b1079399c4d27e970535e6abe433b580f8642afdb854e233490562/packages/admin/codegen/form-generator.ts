import type {
  ParsedContentType,
  ParsedField,
  ParsedParagraphType,
  ParsedTaxonomyType,
} from '@bobbykim/manguito-cms-core'

const ADMIN_PKG = '@bobbykim/manguito-cms-admin'

const COMPONENT_NAME: Record<string, string> = {
  'text-input': 'TextInput',
  'rich-text-editor': 'RichTextEditor',
  'number-input': 'NumberInput',
  checkbox: 'BooleanToggle',
  'date-picker': 'DatePicker',
  'file-upload': 'MediaUpload',
  select: 'EnumSelect',
  'typeahead-select': 'ReferenceSelect',
  'paragraph-embed': 'ParagraphEmbed',
}

const COMPONENT_IMPORT: Record<string, string> = {
  TextInput: `${ADMIN_PKG}/src/components/fields/TextInput.vue`,
  RichTextEditor: `${ADMIN_PKG}/src/components/fields/RichTextEditor.vue`,
  NumberInput: `${ADMIN_PKG}/src/components/fields/NumberInput.vue`,
  BooleanToggle: `${ADMIN_PKG}/src/components/fields/BooleanToggle.vue`,
  DatePicker: `${ADMIN_PKG}/src/components/fields/DatePicker.vue`,
  MediaUpload: `${ADMIN_PKG}/src/components/fields/MediaUpload.vue`,
  EnumSelect: `${ADMIN_PKG}/src/components/fields/EnumSelect.vue`,
  ReferenceSelect: `${ADMIN_PKG}/src/components/fields/ReferenceSelect.vue`,
  ParagraphEmbed: `${ADMIN_PKG}/src/components/fields/ParagraphEmbed.vue`,
}

// Escape backslashes and single quotes for use inside JS single-quoted string literals.
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function str(s: string): string {
  return `'${esc(s)}'`
}

// Escape characters that are unsafe inside an HTML double-quoted attribute value.
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// "paragraph--photo_card" → "PhotoCardForm"
function paragraphRefToImportName(ref: string): string {
  const segment = ref.includes('--') ? ref.slice(ref.indexOf('--') + 2) : ref
  const pascal = segment
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return `${pascal}Form`
}

// Build the minimal JS object literal for the :field binding.
// Includes only the properties each component actually reads at runtime.
function buildFieldObject(field: ParsedField): string {
  const comp = field.ui_component
  const base = `name: ${str(field.name)}, label: ${str(field.label)}, field_type: ${str(field.field_type)}, required: ${field.required}`

  switch (comp.component) {
    case 'number-input': {
      const vParts = [`required: ${field.required}`]
      if (field.validation.min !== undefined) vParts.push(`min: ${field.validation.min}`)
      if (field.validation.max !== undefined) vParts.push(`max: ${field.validation.max}`)
      return `{ ${base}, validation: { ${vParts.join(', ')} } }`
    }
    case 'select': {
      const vals = comp.options.map(str).join(', ')
      return `{ ${base}, validation: { required: ${field.required}, allowed_values: [${vals}] } }`
    }
    case 'typeahead-select': {
      const vParts = [`required: ${field.required}`]
      if (field.validation.max_items !== undefined) vParts.push(`max_items: ${field.validation.max_items}`)
      return `{ ${base}, validation: { ${vParts.join(', ')} }, ui_component: { component: 'typeahead-select', ref: ${str(comp.ref)}, rel: ${str(comp.rel)} } }`
    }
    case 'file-upload': {
      const mimes = (field.validation.allowed_mime_types ?? []).map(str).join(', ')
      return `{ ${base}, validation: { required: ${field.required}, allowed_mime_types: [${mimes}] }, ui_component: { component: 'file-upload', accepted_mime_types: [${mimes}] } }`
    }
    default:
      return `{ ${base} }`
  }
}

function renderField(field: ParsedField, indent: string): string {
  const compName = COMPONENT_NAME[field.ui_component.component]!
  const fieldObj = buildFieldObject(field)
  const attr = indent + '  '

  const lines: string[] = [`${indent}<${compName}`]
  lines.push(`${attr}:field="${fieldObj}"`)

  if (field.ui_component.component === 'paragraph-embed') {
    const importName = paragraphRefToImportName(field.ui_component.ref)
    lines.push(`${attr}:formComponent="${importName}"`)
  }

  lines.push(`${attr}:modelValue="modelValue.${field.name}"`)
  lines.push(`${attr}:error="errors.${field.name}"`)
  lines.push(`${attr}:disabled="disabled"`)
  lines.push(`${attr}@update:modelValue="update('${field.name}', $event)"`)
  lines.push(`${indent}/>`)

  return lines.join('\n')
}

export function generateFormComponent(
  schema: ParsedContentType | ParsedParagraphType | ParsedTaxonomyType
): string {
  const { fields } = schema

  // Collect needed field component imports (deduplicated).
  const neededComponents = new Set<string>()
  // Collect paragraph SFC imports in order of first appearance.
  const paragraphRefs: Array<{ ref: string; importName: string }> = []
  const seenRefs = new Set<string>()

  for (const field of fields) {
    const comp = COMPONENT_NAME[field.ui_component.component]
    if (comp) neededComponents.add(comp)

    if (field.ui_component.component === 'paragraph-embed') {
      const { ref } = field.ui_component
      if (!seenRefs.has(ref)) {
        seenRefs.add(ref)
        paragraphRefs.push({ ref, importName: paragraphRefToImportName(ref) })
      }
    }
  }

  // Import lines: field components (alphabetical), paragraph SFCs (relative), then composable.
  const importLines: string[] = []

  for (const comp of Array.from(neededComponents).sort()) {
    importLines.push(`import ${comp} from '${COMPONENT_IMPORT[comp]}'`)
  }

  for (const { importName, ref } of paragraphRefs) {
    importLines.push(`import ${importName} from './${ref}.vue'`)
  }

  importLines.push(`import { useFormValidation } from '${ADMIN_PKG}/src/composables/useFormValidation'`)

  const scriptLines = [
    '<script setup lang="ts">',
    ...importLines,
    '',
    'const props = defineProps<{',
    '  modelValue: Record<string, unknown>',
    '  disabled?: boolean',
    '}>()',
    '',
    'const emit = defineEmits<{',
    "  'update:modelValue': [value: Record<string, unknown>]",
    '}>()',
    '',
    'const { errors } = useFormValidation()',
    '',
    'function update(field: string, value: unknown) {',
    "  emit('update:modelValue', { ...props.modelValue, [field]: value })",
    '}',
    '</script>',
  ]

  const templateLines: string[] = ['', '<template>']

  if (schema.schema_type === 'content-type') {
    const fieldByName = new Map<string, ParsedField>(fields.map(f => [f.name, f]))

    templateLines.push('  <Tabs>')
    for (const tab of schema.ui.tabs) {
      templateLines.push(`    <Tab name="${escAttr(tab.name)}" label="${escAttr(tab.label)}">`)
      for (const fieldName of tab.fields) {
        templateLines.push(renderField(fieldByName.get(fieldName)!, '      '))
      }
      templateLines.push('    </Tab>')
    }
    templateLines.push('  </Tabs>')
  } else {
    // Flat layout for paragraph and taxonomy types.
    for (const field of fields) {
      templateLines.push(renderField(field, '  '))
    }
  }

  templateLines.push('</template>')

  const header =
    '<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->'

  return [header, ...scriptLines, ...templateLines].join('\n')
}
