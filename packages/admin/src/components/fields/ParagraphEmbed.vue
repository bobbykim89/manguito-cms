<script setup lang="ts">
import { ref, computed, nextTick, watch, toRaw } from 'vue'
import type { Component } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { relationCardinality } from '@bobbykim/manguito-cms-core/cardinality'
import { moveItem } from '../../utils/move-item'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
  formComponent: Component
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>[] | Record<string, unknown> | null]
}>()

// A one-to-one paragraph holds one item: an object, or null when empty. Any
// other value (a stale array, undefined from a new nested item) reads as empty.
const isSingle = computed(() => relationCardinality(props.field) === 'one')

const singleValue = computed<Record<string, unknown> | null>(() => {
  const v = props.modelValue
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
})

function addSingle() {
  emit('update:modelValue', {})
}

function removeSingle() {
  emit('update:modelValue', null)
}

function updateSingle(value: Record<string, unknown>) {
  emit('update:modelValue', value)
}

const safeValue = computed<Record<string, unknown>[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, unknown>[])
    : []
)

// A stable key per item, so an item's field components (a media preview, a
// reference's loaded label) follow it through a move or a remove instead of
// staying at its old position. Items are recreated by spreads, so their
// identity cannot serve; the list's can. Every list this component emits
// carries the keys it should have, and they take effect when that list comes
// back as the model. A list replaced from outside keeps the keys when its
// length is unchanged, and gets fresh ones otherwise.
let keySeq = 0
const freshKeys = (n: number) => Array.from({ length: n }, () => keySeq++)
const itemKeys = ref<number[]>(freshKeys(safeValue.value.length))
let pending: { list: Record<string, unknown>[]; keys: number[] } | null = null

watch(
  safeValue,
  (list) => {
    if (pending && toRaw(list) === pending.list) itemKeys.value = pending.keys
    else if (itemKeys.value.length !== list.length) itemKeys.value = freshKeys(list.length)
    pending = null
  },
  { flush: 'sync' }
)

function emitList(items: Record<string, unknown>[], keys: number[]) {
  pending = { list: items, keys }
  emit('update:modelValue', items)
}

// The list and its keys after moving the item at `from` to `to`, renumbering
// order; null when nothing moves.
function moved(from: number, to: number): [Record<string, unknown>[], number[]] | null {
  const items = moveItem(safeValue.value, from, to)
  const keys = moveItem(itemKeys.value, from, to)
  return items && keys ? [items.map((item, i) => ({ ...item, order: i })), keys] : null
}

// Drag state — not tested (too coupled to DOM / jsdom unreliable).
const dragFromIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function addItem() {
  const items = [...safeValue.value]
  items.push({ order: items.length })
  emitList(items, [...itemKeys.value, ...freshKeys(1)])
}

function removeItem(index: number) {
  const items = [...safeValue.value]
  items.splice(index, 1)
  emitList(
    items.map((item, i) => ({ ...item, order: i })),
    itemKeys.value.filter((_, i) => i !== index)
  )
}

function updateItem(index: number, value: Record<string, unknown>) {
  const items = [...safeValue.value]
  items[index] = { ...value, order: index }
  emitList(items, itemKeys.value)
}

function onDragStart(index: number) {
  dragFromIndex.value = index
}

function onDragOver(index: number) {
  dragOverIndex.value = index
}

function onDrop(toIndex: number) {
  const next = dragFromIndex.value === null ? null : moved(dragFromIndex.value, toIndex)
  dragFromIndex.value = null
  dragOverIndex.value = null
  // null: dropped in place, or a drag index the list no longer has.
  if (next) emitList(...next)
}

// Keyboard reorder. Focus follows the moved item: onto the button just
// pressed, or onto its other one when the item reaches an end, so a keyboard
// user can keep moving it.
const itemList = ref<HTMLElement | null>(null)

async function moveParagraph(index: number, step: -1 | 1) {
  const next = moved(index, index + step)
  if (!next) return
  emitList(...next)
  await nextTick()
  // Scoped to this list's own items and headers: an item body can hold a
  // nested paragraph list with the same attributes.
  const header = itemList.value?.querySelector<HTMLElement>(
    `:scope > [data-item-index="${index + step}"] > [data-item-header]`
  )
  const same = header?.querySelector<HTMLElement>(`[data-move="${step < 0 ? 'earlier' : 'later'}"]`)
  ;(same ?? header?.querySelector<HTMLElement>('[data-move]'))?.focus()
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

    <!-- One-to-one: a single item, or an Add button when empty -->
    <template v-if="isSingle">
      <div
        v-if="singleValue"
        :class="['mt-1 rounded-md border border-gray-200 bg-white', disabled && 'opacity-60']"
      >
        <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <span class="text-xs font-medium text-gray-500">{{ field.label }}</span>
          <button
            v-if="!disabled"
            type="button"
            class="ml-auto text-xs text-red-500 hover:text-red-700"
            :aria-label="`Remove ${field.label}`"
            @click="removeSingle"
          >
            Remove
          </button>
        </div>
        <div class="p-3">
          <component
            :is="formComponent"
            :model-value="singleValue"
            :disabled="disabled"
            @update:model-value="(v: unknown) => updateSingle(v as Record<string, unknown>)"
          />
        </div>
      </div>
      <button
        v-else-if="!disabled"
        type="button"
        class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600"
        @click="addSingle"
      >
        <span aria-hidden="true">+</span>
        Add {{ field.label }}
      </button>
    </template>

    <!-- One-to-many: an ordered, reorderable list -->
    <template v-else>
      <div ref="itemList" class="mt-1 space-y-2">
        <div
          v-for="(item, i) in safeValue"
          :key="itemKeys[i]"
          draggable="true"
          :data-item-index="i"
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
          <div data-item-header class="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
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
            <div class="ml-auto flex items-center gap-1">
            <button
              v-if="i > 0 && !disabled"
              type="button"
              data-move="earlier"
              class="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
              :aria-label="`Move item ${i + 1} earlier`"
              @click="moveParagraph(i, -1)"
            >
              <span aria-hidden="true">&uarr;</span>
            </button>
            <button
              v-if="i < safeValue.length - 1 && !disabled"
              type="button"
              data-move="later"
              class="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
              :aria-label="`Move item ${i + 1} later`"
              @click="moveParagraph(i, 1)"
            >
              <span aria-hidden="true">&darr;</span>
            </button>
            <button
              v-if="!disabled"
              type="button"
              class="ml-1 text-xs text-red-500 hover:text-red-700"
              :aria-label="`Remove item ${i + 1}`"
              @click="removeItem(i)"
            >
              Remove
            </button>
            </div>
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
    </template>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
