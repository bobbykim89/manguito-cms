<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Component } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
  formComponent: Component
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>[]]
}>()

const safeValue = computed<Record<string, unknown>[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, unknown>[])
    : []
)

// Drag state — not tested (too coupled to DOM / jsdom unreliable).
const dragFromIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function addItem() {
  const items = [...safeValue.value]
  items.push({ order: items.length })
  emit('update:modelValue', items)
}

function removeItem(index: number) {
  const items = [...safeValue.value]
  items.splice(index, 1)
  emit('update:modelValue', items.map((item, i) => ({ ...item, order: i })))
}

function updateItem(index: number, value: Record<string, unknown>) {
  const items = [...safeValue.value]
  items[index] = { ...value, order: index }
  emit('update:modelValue', items)
}

function onDragStart(index: number) {
  dragFromIndex.value = index
}

function onDragOver(index: number) {
  dragOverIndex.value = index
}

function onDrop(toIndex: number) {
  if (dragFromIndex.value === null || dragFromIndex.value === toIndex) {
    dragFromIndex.value = null
    dragOverIndex.value = null
    return
  }
  const items = [...safeValue.value]
  const [moved] = items.splice(dragFromIndex.value, 1)
  if (moved === undefined) return
  items.splice(toIndex, 0, moved)
  emit('update:modelValue', items.map((item, i) => ({ ...item, order: i })))
  dragFromIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  dragFromIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div>
    <label class="block text-[13px] font-semibold text-[#3D3D52]">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <div class="mt-1 space-y-2">
      <div
        v-for="(item, i) in safeValue"
        :key="i"
        draggable="true"
        :class="[
          'rounded-md border bg-white transition-colors',
          dragOverIndex === i && dragFromIndex !== i
            ? 'border-indigo-400 ring-2 ring-indigo-200'
            : 'border-gray-200',
          disabled && 'opacity-60',
        ]"
        @dragstart="onDragStart(i)"
        @dragover.prevent="onDragOver(i)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
      >
        <!-- Item header: drag handle + label + remove -->
        <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <span
            class="cursor-grab select-none text-gray-400"
            title="Drag to reorder"
            aria-hidden="true"
          >
            &#8942;&#8942;
          </span>
          <span class="text-xs font-medium text-gray-500">
            Item {{ i + 1 }}
          </span>
          <button
            v-if="!disabled"
            type="button"
            class="ml-auto text-xs text-red-500 hover:text-red-700"
            :aria-label="`Remove item ${i + 1}`"
            @click="removeItem(i)"
          >
            Remove
          </button>
        </div>

        <!-- Paragraph form rendered via dynamic component -->
        <div class="p-3">
          <component
            :is="formComponent"
            :model-value="item"
            :disabled="disabled"
            @update:model-value="(v: unknown) => updateItem(i, v as Record<string, unknown>)"
          />
        </div>
      </div>
    </div>

    <!-- Add item button -->
    <button
      v-if="!disabled"
      type="button"
      class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600"
      @click="addItem"
    >
      <span aria-hidden="true">+</span>
      Add {{ field.label }}
    </button>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
