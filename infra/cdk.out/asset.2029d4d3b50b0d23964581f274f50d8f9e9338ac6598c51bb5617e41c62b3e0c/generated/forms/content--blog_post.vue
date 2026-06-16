<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->
<script setup lang="ts">
import MediaUpload from '@bobbykim/manguito-cms-admin/src/components/fields/MediaUpload.vue'
import ParagraphEmbed from '@bobbykim/manguito-cms-admin/src/components/fields/ParagraphEmbed.vue'
import ReferenceSelect from '@bobbykim/manguito-cms-admin/src/components/fields/ReferenceSelect.vue'
import RichTextEditor from '@bobbykim/manguito-cms-admin/src/components/fields/RichTextEditor.vue'
import TextInput from '@bobbykim/manguito-cms-admin/src/components/fields/TextInput.vue'
import PhotoCardForm from './paragraph--photo_card.vue'
import LinkItemForm from './paragraph--link_item.vue'
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
    <Tab name="primary_tab" label="Primary Tab">
      <TextInput
        :field="{ name: 'blog_title', label: 'Title', field_type: 'text/plain', required: true }"
        :modelValue="modelValue.blog_title"
        :error="errors.blog_title"
        :disabled="disabled"
        @update:modelValue="update('blog_title', $event)"
      />
      <MediaUpload
        :field="{ name: 'blog_hero_image', label: 'Hero Image', field_type: 'image', required: false, validation: { required: false, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] }, ui_component: { component: 'file-upload', accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] } }"
        :modelValue="modelValue.blog_hero_image"
        :error="errors.blog_hero_image"
        :disabled="disabled"
        @update:modelValue="update('blog_hero_image', $event)"
      />
      <RichTextEditor
        :field="{ name: 'blog_desc', label: 'Description', field_type: 'text/rich', required: true }"
        :modelValue="modelValue.blog_desc"
        :error="errors.blog_desc"
        :disabled="disabled"
        @update:modelValue="update('blog_desc', $event)"
      />
    </Tab>
    <Tab name="meta_info" label="Meta Information Tab">
      <TextInput
        :field="{ name: 'blog_meta_title', label: 'Meta Title', field_type: 'text/plain', required: true }"
        :modelValue="modelValue.blog_meta_title"
        :error="errors.blog_meta_title"
        :disabled="disabled"
        @update:modelValue="update('blog_meta_title', $event)"
      />
      <TextInput
        :field="{ name: 'blog_meta_desc', label: 'Meta Description', field_type: 'text/plain', required: true }"
        :modelValue="modelValue.blog_meta_desc"
        :error="errors.blog_meta_desc"
        :disabled="disabled"
        @update:modelValue="update('blog_meta_desc', $event)"
      />
    </Tab>
    <Tab name="first_content_tab" label="First Content Block Tab">
      <ParagraphEmbed
        :field="{ name: 'blog_cards', label: 'Cards', field_type: 'paragraph', required: true }"
        :formComponent="PhotoCardForm"
        :modelValue="modelValue.blog_cards"
        :error="errors.blog_cards"
        :disabled="disabled"
        @update:modelValue="update('blog_cards', $event)"
      />
      <ParagraphEmbed
        :field="{ name: 'blog_link', label: 'Link', field_type: 'paragraph', required: false }"
        :formComponent="LinkItemForm"
        :modelValue="modelValue.blog_link"
        :error="errors.blog_link"
        :disabled="disabled"
        @update:modelValue="update('blog_link', $event)"
      />
      <ReferenceSelect
        :field="{ name: 'blog_related', label: 'Related Posts', field_type: 'reference', required: false, validation: { required: false, max_items: 10 }, ui_component: { component: 'typeahead-select', ref: 'content--blog_post', rel: 'many-to-many' } }"
        :modelValue="modelValue.blog_related"
        :error="errors.blog_related"
        :disabled="disabled"
        @update:modelValue="update('blog_related', $event)"
      />
    </Tab>
  </Tabs>
</template>