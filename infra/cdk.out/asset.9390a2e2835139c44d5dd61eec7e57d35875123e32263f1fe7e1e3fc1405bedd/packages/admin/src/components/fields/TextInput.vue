<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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

const isSlugField = computed(
  () => props.field.name === 'slug' || props.field.name.endsWith('_slug')
)

// Local raw text — allows free typing while emitting formatted slug value.
const localText = ref(typeof props.modelValue === 'string' ? props.modelValue : '')

// Sync when modelValue changes from outside (form reset / initial load).
watch(
  () => props.modelValue,
  (v) => {
    if (typeof v === 'string' && v !== localText.value) {
      localText.value = v
    }
  }
)

function formatSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const slugPreview = computed(() =>
  isSlugField.value ? formatSlug(localText.value) : ''
)

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  localText.value = value
  emit('update:modelValue', isSlugField.value ? formatSlug(value) : value)
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
        type="text"
        :value="localText"
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

    <!-- Slug format preview — shown below for slug fields -->
    <p
      v-if="isSlugField && localText"
      class="mt-1 text-xs text-gray-500"
    >
      Slug: <span class="font-mono">{{ slugPreview }}</span>
    </p>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
