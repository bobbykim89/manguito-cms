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

const options = computed(() => props.field.validation.allowed_values ?? [])
const hasOptions = computed(() => options.value.length > 0)

const selectValue = computed(() =>
  typeof props.modelValue === 'string' ? props.modelValue : ''
)

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
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
      <select
        :id="field.name"
        :value="selectValue"
        :disabled="disabled || !hasOptions"
        :class="[
          'block w-full rounded-[11px] border px-3.5 py-3 text-sm focus:outline-none focus:ring-[3px]',
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
              : 'border-[#E4E3EE] bg-[#FBFBFD] focus:border-indigo-400 focus:bg-white focus:ring-indigo-50',
          (disabled || !hasOptions) && 'cursor-not-allowed bg-gray-50 opacity-60',
        ]"
        @change="onChange"
      >
        <option value="" disabled>
          {{ hasOptions ? `Select ${field.label}` : 'No options available' }}
        </option>
        <option
          v-for="opt in options"
          :key="opt"
          :value="opt"
        >
          {{ opt }}
        </option>
      </select>
    </div>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
