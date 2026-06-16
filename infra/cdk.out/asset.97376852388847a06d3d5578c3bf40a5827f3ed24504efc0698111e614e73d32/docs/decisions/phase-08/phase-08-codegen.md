# Decision — Static Form Codegen

> Defines the form generator function, generated SFC structure, generation order, and paragraph nesting handling.

---

## Overview

`manguito build` generates one static Vue SFC per content type, paragraph type, and taxonomy type. These are functionally identical to what the dynamic renderer produces at runtime in dev mode — same field components, same props, same events, just hardcoded instead of looped.

---

## Generator Function

Lives in `packages/admin/codegen/form-generator.ts`. Imported by the CLI via the `./codegen` subpath export.

```ts
export function generateFormComponent(
  schema: ParsedContentSchema | ParsedParagraphSchema | ParsedTaxonomySchema
): string
```

Pure function — takes a parsed schema, returns a Vue SFC as a string. No file I/O, no side effects. The CLI calls it and writes the output to disk.

---

## Output Location

```
.manguito/
└── forms/
    ├── content--blog_post.vue
    ├── content--home_page.vue
    ├── paragraph--photo_card.vue
    ├── paragraph--link_item.vue
    └── taxonomy--daily_post.vue
```

The CLI writes all generated files before Vite runs. `.manguito/` is gitignored.

---

## Generation Order

The CLI generates files in topological dependency order:

1. **Enum types** — no dependencies
2. **Paragraph types** — topologically sorted (nested paragraph before parent paragraph)
3. **Taxonomy types** — no paragraph dependencies
4. **Content types** — may import paragraph form components

This matches the Phase 3 DB codegen ordering. The parser's `CIRCULAR_REFERENCE` error guarantee means the topological sort always terminates.

---

## Import Style — Package Imports

Generated SFCs use package imports:

```ts
import TextInput from '@bobbykim/manguito-cms-admin/src/components/fields/TextInput.vue'
```

Not relative imports (fragile, assumes directory structure) and not Vite aliases (requires extra setup). Package imports are resolved by pnpm workspace resolution — stable and explicit.

---

## Generated SFC Structure — Content Type

```vue
<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->
<script setup lang="ts">
import TextInput from '@bobbykim/manguito-cms-admin/src/components/fields/TextInput.vue'
import RichTextEditor from '@bobbykim/manguito-cms-admin/src/components/fields/RichTextEditor.vue'
import { useFormValidation } from '@bobbykim/manguito-cms-admin/src/composables/useFormValidation'

const props = defineProps<{
  modelValue: Record<string, unknown>
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const { errors } = useFormValidation()

function update(field: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}
</script>

<template>
  <Tabs>
    <Tab name="main_tab" label="Main">
      <TextInput
        :field="{ name: 'blog_title', label: 'Title', type: 'text/plain', required: true }"
        :modelValue="modelValue.blog_title"
        :error="errors.blog_title"
        :disabled="disabled"
        @update:modelValue="update('blog_title', $event)"
      />
      <RichTextEditor
        :field="{ name: 'blog_body', label: 'Body', type: 'text/rich', required: false }"
        :modelValue="modelValue.blog_body"
        :error="errors.blog_body"
        :disabled="disabled"
        @update:modelValue="update('blog_body', $event)"
      />
    </Tab>
  </Tabs>
</template>
```

Tabs are generated from `UiMeta` preserved by the parser. Paragraph and taxonomy types use flat layout — no `Tabs`/`Tab` wrapper.

---

## Paragraph Fields in Content Types

When the generator encounters a `paragraph` field, it imports the generated paragraph SFC and passes it to `ParagraphEmbed.vue` via `formComponent` prop:

```vue
<script setup lang="ts">
import ParagraphEmbed from '@bobbykim/manguito-cms-admin/src/components/fields/ParagraphEmbed.vue'
import PhotoCardForm from './paragraph--photo_card.vue'
</script>

<template>
  <ParagraphEmbed
    :field="{ name: 'blog_cards', label: 'Cards', type: 'paragraph', ref: 'paragraph--photo_card', max: 8 }"
    :formComponent="PhotoCardForm"
    :modelValue="modelValue.blog_cards"
    :error="errors.blog_cards"
    :disabled="disabled"
    @update:modelValue="update('blog_cards', $event)"
  />
</template>
```

`ParagraphEmbed.vue` accepts `formComponent` as a Vue `Component` prop and uses `<component :is="formComponent" />` to render each paragraph instance's inner form.

---

## Nested Paragraphs (One Level Deep)

Paragraphs support one level of nesting — a paragraph may reference another paragraph, but that nested paragraph may not reference yet another paragraph.

The same `formComponent` prop pattern applies at the paragraph level:

```vue
<!-- paragraph--photo_card.vue — generated -->
<script setup lang="ts">
import ParagraphEmbed from '@bobbykim/manguito-cms-admin/src/components/fields/ParagraphEmbed.vue'
import LinkItemForm from './paragraph--link_item.vue'
</script>

<template>
  <!-- other fields... -->
  <ParagraphEmbed
    :field="{ name: 'photo_card_link', ... }"
    :formComponent="LinkItemForm"
    ...
  />
</template>
```

The topological sort ensures `paragraph--link_item.vue` is generated before `paragraph--photo_card.vue`.

---

## Snapshot Testing

The `generateFormComponent` function is tested with Vitest snapshot tests:

```ts
it('generates correct SFC for blog_post schema', () => {
  const sfc = generateFormComponent(blogPostSchema)
  expect(sfc).toMatchSnapshot()
})
```

Snapshot the string output directly — fast, pure, no DOM needed. Catches codegen regressions without brittleness. See [phase-08-testing.md](./phase-08-testing.md) for full testing strategy.
