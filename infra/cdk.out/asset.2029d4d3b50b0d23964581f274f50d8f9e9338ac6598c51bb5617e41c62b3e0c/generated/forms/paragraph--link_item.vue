<!-- AUTO-GENERATED — do not edit. Re-run `manguito build` to regenerate. -->
<script setup lang="ts">
import EnumSelect from '@bobbykim/manguito-cms-admin/src/components/fields/EnumSelect.vue'
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
    :field="{ name: 'link_item_url', label: 'url', field_type: 'text/plain', required: true }"
    :modelValue="modelValue.link_item_url"
    :error="errors.link_item_url"
    :disabled="disabled"
    @update:modelValue="update('link_item_url', $event)"
  />
  <EnumSelect
    :field="{ name: 'link_item_target', label: 'Target', field_type: 'enum', required: true, validation: { required: true, allowed_values: ['_self', '_blank'] } }"
    :modelValue="modelValue.link_item_target"
    :error="errors.link_item_target"
    :disabled="disabled"
    @update:modelValue="update('link_item_target', $event)"
  />
  <TextInput
    :field="{ name: 'link_item_text', label: 'Text', field_type: 'text/plain', required: true }"
    :modelValue="modelValue.link_item_text"
    :error="errors.link_item_text"
    :disabled="disabled"
    @update:modelValue="update('link_item_text', $event)"
  />
</template>