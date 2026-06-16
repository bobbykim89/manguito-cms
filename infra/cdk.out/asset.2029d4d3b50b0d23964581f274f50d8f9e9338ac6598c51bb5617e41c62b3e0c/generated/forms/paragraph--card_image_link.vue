<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->
<script setup lang="ts">
import MediaUpload from '@bobbykim/manguito-cms-admin/src/components/fields/MediaUpload.vue'
import ParagraphEmbed from '@bobbykim/manguito-cms-admin/src/components/fields/ParagraphEmbed.vue'
import RichTextEditor from '@bobbykim/manguito-cms-admin/src/components/fields/RichTextEditor.vue'
import TextInput from '@bobbykim/manguito-cms-admin/src/components/fields/TextInput.vue'
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
  <TextInput
    :field="{ name: 'card_image_link_title', label: 'Title', field_type: 'text/plain', required: true }"
    :modelValue="modelValue.card_image_link_title"
    :error="errors.card_image_link_title"
    :disabled="disabled"
    @update:modelValue="update('card_image_link_title', $event)"
  />
  <MediaUpload
    :field="{ name: 'card_image_link_image', label: 'Image', field_type: 'image', required: true, validation: { required: true, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] }, ui_component: { component: 'file-upload', accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] } }"
    :modelValue="modelValue.card_image_link_image"
    :error="errors.card_image_link_image"
    :disabled="disabled"
    @update:modelValue="update('card_image_link_image', $event)"
  />
  <RichTextEditor
    :field="{ name: 'card_image_link_text', label: 'Text', field_type: 'text/rich', required: false }"
    :modelValue="modelValue.card_image_link_text"
    :error="errors.card_image_link_text"
    :disabled="disabled"
    @update:modelValue="update('card_image_link_text', $event)"
  />
  <ParagraphEmbed
    :field="{ name: 'card_image_link_link', label: 'Link', field_type: 'paragraph', required: true }"
    :formComponent="LinkItemForm"
    :modelValue="modelValue.card_image_link_link"
    :error="errors.card_image_link_link"
    :disabled="disabled"
    @update:modelValue="update('card_image_link_link', $event)"
  />
</template>