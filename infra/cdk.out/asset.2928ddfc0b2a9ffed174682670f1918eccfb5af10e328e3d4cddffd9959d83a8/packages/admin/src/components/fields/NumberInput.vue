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
  'update:modelValue': [value: number | null]
}>()

const step = computed(() => props.field.field_type === 'integer' ? 1 : 0.01)
const min = computed(() => props.field.validation.min)
const max = computed(() => props.field.validation.max)

const numValue = computed(() =>
  typeof props.modelValue === 'number' ? props.modelValue : ''
)

function onInput(event: Event) {
  const input = event.target as HTMLInputElement
  const n = input.valueAsNumber
  emit('update:modelValue', isNaN(n) ? null : n)
}
</script>

<template>
  <div>
    <label
      :for="field.name"
      class="block text-sm font-medium text-gray-700"
    >
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <div class="mt-1">
      <input
        :id="field.name"
        type="number"
        :value="numValue"
        :step="step"
        :min="min"
        :max="max"
        :disabled="disabled"
        :placeholder="field.label"
        :class="[
          'block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2',
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
            : 'border-gray-300 focus:border-indigo-400 focus:ring-indigo-200',
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
