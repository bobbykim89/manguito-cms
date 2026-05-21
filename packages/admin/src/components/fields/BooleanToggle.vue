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
  'update:modelValue': [value: boolean]
}>()

const boolValue = computed(() => props.modelValue === true)

function toggle() {
  if (!props.disabled) {
    emit('update:modelValue', !boolValue.value)
  }
}
</script>

<template>
  <div>
    <span class="block text-sm font-medium text-gray-700">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </span>

    <div class="mt-2 flex items-center gap-3">
      <button
        :id="field.name"
        type="button"
        role="switch"
        :aria-checked="boolValue"
        :aria-label="field.label"
        :disabled="disabled"
        :class="[
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
          boolValue ? 'bg-indigo-600' : 'bg-gray-200',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        ]"
        @click="toggle"
      >
        <span
          :class="[
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            boolValue ? 'translate-x-6' : 'translate-x-1',
          ]"
        />
      </button>
      <span class="text-sm text-gray-600 select-none">
        {{ boolValue ? 'Yes' : 'No' }}
      </span>
    </div>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
