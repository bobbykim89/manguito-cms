<script setup lang="ts">
import { computed } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// datetime-local requires "YYYY-MM-DDTHH:MM". ISO strings are "YYYY-MM-DDTHH:MM:SS.mssZ".
// Slice the first 16 characters to get the compatible format, treating stored value as UTC.
const displayValue = computed(() => {
  if (typeof props.modelValue !== 'string' || !props.modelValue) return ''
  return props.modelValue.slice(0, 16)
})

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  // Append seconds and Z to form a valid ISO 8601 UTC datetime string.
  emit('update:modelValue', value ? `${value}:00.000Z` : '')
}
</script>

<template>
  <div>
    <label
      :for="field.name"
      class="block text-[13px] font-semibold text-[#3D3D52]"
    >
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <div class="mt-1">
      <input
        :id="field.name"
        type="datetime-local"
        :value="displayValue"
        :disabled="disabled"
        :class="[
          'block w-full rounded-[11px] border px-3.5 py-3 text-sm focus:outline-none focus:ring-[3px]',
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
              : 'border-[#E4E3EE] bg-[#FBFBFD] focus:border-indigo-400 focus:bg-white focus:ring-indigo-50',
          disabled && 'cursor-not-allowed bg-gray-50 opacity-60',
        ]"
        @input="onInput"
      />
    </div>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
