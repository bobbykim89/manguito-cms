<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->
<script setup lang="ts">
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
    :field="{ name: 'daily_title', label: 'Title', field_type: 'text/plain', required: true }"
    :modelValue="modelValue.daily_title"
    :error="errors.daily_title"
    :disabled="disabled"
    @update:modelValue="update('daily_title', $event)"
  />
  <RichTextEditor
    :field="{ name: 'daily_desc', label: 'Description', field_type: 'text/rich', required: true }"
    :modelValue="modelValue.daily_desc"
    :error="errors.daily_desc"
    :disabled="disabled"
    @update:modelValue="update('daily_desc', $event)"
  />
</template>