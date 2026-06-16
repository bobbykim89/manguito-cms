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
  <Tabs>
    <Tab name="primary_tab" label="Primary Tab">
      <TextInput
        :field="{ name: 'title', label: 'Title', field_type: 'text/plain', required: true }"
        :modelValue="modelValue.title"
        :error="errors.title"
        :disabled="disabled"
        @update:modelValue="update('title', $event)"
      />
      <MediaUpload
        :field="{ name: 'hero_image', label: 'Hero Image', field_type: 'image', required: false, validation: { required: false, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] }, ui_component: { component: 'file-upload', accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] } }"
        :modelValue="modelValue.hero_image"
        :error="errors.hero_image"
        :disabled="disabled"
        @update:modelValue="update('hero_image', $event)"
      />
      <RichTextEditor
        :field="{ name: 'body', label: 'Body', field_type: 'text/rich', required: false }"
        :modelValue="modelValue.body"
        :error="errors.body"
        :disabled="disabled"
        @update:modelValue="update('body', $event)"
      />
    </Tab>
  </Tabs>
</template>