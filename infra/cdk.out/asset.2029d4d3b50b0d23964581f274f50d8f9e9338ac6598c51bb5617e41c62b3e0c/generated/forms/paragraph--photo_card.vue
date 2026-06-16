<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->
<script setup lang="ts">
import MediaUpload from '@bobbykim/manguito-cms-admin/src/components/fields/MediaUpload.vue'
import RichTextEditor from '@bobbykim/manguito-cms-admin/src/components/fields/RichTextEditor.vue'
import TextInput from '@bobbykim/manguito-cms-admin/src/components/fields/TextInput.vue'
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
    :field="{ name: 'photo_card_title', label: 'Title', field_type: 'text/plain', required: true }"
    :modelValue="modelValue.photo_card_title"
    :error="errors.photo_card_title"
    :disabled="disabled"
    @update:modelValue="update('photo_card_title', $event)"
  />
  <MediaUpload
    :field="{ name: 'photo_card_image', label: 'Image', field_type: 'image', required: true, validation: { required: true, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] }, ui_component: { component: 'file-upload', accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] } }"
    :modelValue="modelValue.photo_card_image"
    :error="errors.photo_card_image"
    :disabled="disabled"
    @update:modelValue="update('photo_card_image', $event)"
  />
  <RichTextEditor
    :field="{ name: 'photo_card_text', label: 'Text', field_type: 'text/rich', required: false }"
    :modelValue="modelValue.photo_card_text"
    :error="errors.photo_card_text"
    :disabled="disabled"
    @update:modelValue="update('photo_card_text', $event)"
  />
</template>