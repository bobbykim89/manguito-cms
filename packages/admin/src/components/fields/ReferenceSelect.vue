<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { relationCardinality } from '@bobbykim/manguito-cms-core/cardinality'
import { useApiClient } from '../../composables/useApiClient'
import { useSchemaStore } from '../../stores/schema'
import { moveItem } from '../../utils/move-item'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null | string[]]
}>()

const api = useApiClient()
const schemaStore = useSchemaStore()

const typeaheadComp = computed(() => {
  const c = props.field.ui_component
  return c.component === 'typeahead-select' ? c : null
})

const refName = computed(() => typeaheadComp.value?.ref ?? '')
const maxItems = computed(() => props.field.validation.max_items ?? null)
const isMulti = computed(() => relationCardinality(props.field) === 'many')
const isContentRef = computed(() => !!schemaStore.contentTypes[refName.value])

// First text/plain field in the referenced schema — used as the display label.
const titleField = computed<string>(() => {
  const schema = isContentRef.value
    ? schemaStore.contentTypes[refName.value]
    : schemaStore.taxonomyTypes[refName.value]
  return schema?.fields.find(f => f.field_type === 'text/plain')?.name ?? 'id'
})

const selectedIds = computed<string[]>(() => {
  if (isMulti.value) {
    // Each id once, at its first position, as the API stores a list. Links
    // saved before it de-duplicated may still read with repeats.
    return Array.isArray(props.modelValue)
      ? [...new Set((props.modelValue as unknown[]).filter((v): v is string => typeof v === 'string'))]
      : []
  }
  return typeof props.modelValue === 'string' ? [props.modelValue] : []
})

const atLimit = computed(
  () => maxItems.value !== null && selectedIds.value.length >= maxItems.value
)

// Safe accessor for the one-to-one case — avoids undefined index type errors.
const singleId = computed(() => selectedIds.value[0] ?? '')

// id → display label for chips; populated on select and on mount.
const selectedLabels = ref<Record<string, string>>({})

const query = ref('')
const loading = ref(false)
const results = ref<Record<string, unknown>[]>([])
const showDropdown = ref(false)

function basePath(): string {
  return isContentRef.value
    ? `/content/${refName.value}`
    : `/taxonomy/${refName.value}`
}

// The list endpoint's own search: a case-insensitive match on the type's
// text fields and slug, as the content and taxonomy list views use it.
function buildSearchPath(q: string): string {
  const params = new URLSearchParams({ search: q, per_page: '10' })
  return `${basePath()}?${params.toString()}`
}

// The list endpoint's largest page, so one request names at most this many ids.
const LABEL_BATCH = 100

// One list request per batch of ids, filtered by id. The list loads no
// paragraphs or links, where GET /:id loads the whole item (#57).
function buildLabelPath(ids: string[]): string {
  const params = new URLSearchParams(ids.map((id) => ['filter[id]', id]))
  params.set('per_page', String(ids.length))
  return `${basePath()}?${params.toString()}`
}

function labelFor(item: Record<string, unknown>): string {
  return String(item[titleField.value] ?? item.id ?? '')
}

// Numbers each search, so a slower answer to an older query can't replace
// the results (or clear the spinner) of the one typed since.
let searchSeq = 0

const doSearch = useDebounceFn(async (q: string) => {
  const seq = ++searchSeq
  if (q.length < 2) {
    results.value = []
    showDropdown.value = false
    loading.value = false
    return
  }
  loading.value = true
  showDropdown.value = true
  const res = await api.get<Record<string, unknown>[]>(buildSearchPath(q))
  if (seq !== searchSeq) return
  loading.value = false
  if (res.ok) {
    results.value = res.data
  }
}, 300)

function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  doSearch(query.value)
}

function onFocusOut() {
  // Delay so mousedown on a result item can fire before the dropdown closes.
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}

function onFocus() {
  if (query.value.length >= 2) showDropdown.value = true
}

function selectItem(item: Record<string, unknown>) {
  const id = String(item.id)
  selectedLabels.value[id] = labelFor(item)
  query.value = ''
  results.value = []
  showDropdown.value = false

  if (isMulti.value) {
    const next = [...selectedIds.value]
    if (!next.includes(id)) next.push(id)
    emit('update:modelValue', next)
  } else {
    emit('update:modelValue', id)
  }
}

function removeItem(id: string) {
  if (isMulti.value) {
    emit('update:modelValue', selectedIds.value.filter(i => i !== id))
  } else {
    emit('update:modelValue', null)
  }
}

const chipList = ref<HTMLElement | null>(null)

// Moves one chip a place earlier (-1) or later (+1). The list is saved in this
// order and every read returns it so (#57). Focus follows the chip, to the
// same button, or to its other one when the chip reaches an end, so a
// keyboard user can keep moving it.
async function moveChip(index: number, step: -1 | 1) {
  const next = moveItem(selectedIds.value, index, index + step)
  if (!next) return
  emit('update:modelValue', next)
  await nextTick()
  const chip = chipList.value?.querySelector<HTMLElement>(`[data-chip-index="${index + step}"]`)
  const same = chip?.querySelector<HTMLElement>(`[data-move="${step < 0 ? 'earlier' : 'later'}"]`)
  ;(same ?? chip?.querySelector<HTMLElement>('[data-move]'))?.focus()
}

// Display labels for selected ids that have none yet: on mount, and whenever
// the value changes from outside (an id picked from search already has one).
// An id the list doesn't return (a deleted item), or a failed request, shows
// the id itself. Batches go out together.
const pendingLabels = new Set<string>()

async function loadLabels(ids: string[]) {
  const missing = ids.filter((id) => !selectedLabels.value[id] && !pendingLabels.has(id))
  if (missing.length === 0) return
  for (const id of missing) pendingLabels.add(id)
  const batches: string[][] = []
  for (let start = 0; start < missing.length; start += LABEL_BATCH) {
    batches.push(missing.slice(start, start + LABEL_BATCH))
  }
  await Promise.all(
    batches.map(async (batch) => {
      const res = await api.get<Record<string, unknown>[]>(buildLabelPath(batch))
      const found = new Map(res.ok ? res.data.map((item) => [String(item.id), labelFor(item)]) : [])
      for (const id of batch) {
        selectedLabels.value[id] = found.get(id) ?? id
        pendingLabels.delete(id)
      }
    })
  )
}

watch(selectedIds, (ids) => void loadLabels(ids), { immediate: true })
</script>

<template>
  <div>
    <label class="block text-[13px] font-semibold text-[#3D3D52]">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <!-- Removable, reorderable chips — many-to-many -->
    <div
      v-if="isMulti && selectedIds.length"
      ref="chipList"
      class="mt-1.5 flex flex-wrap gap-1.5"
    >
      <span
        v-for="(id, i) in selectedIds"
        :key="id"
        :data-chip-index="i"
        class="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800"
      >
        <!-- Reorder: the list keeps this order when saved. -->
        <button
          v-if="i > 0"
          type="button"
          data-move="earlier"
          :disabled="disabled"
          class="-my-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-indigo-200 disabled:cursor-not-allowed"
          :aria-label="`Move ${selectedLabels[id] ?? id} earlier`"
          @click="moveChip(i, -1)"
        >
          <span aria-hidden="true">&lsaquo;</span>
        </button>
        {{ selectedLabels[id] ?? id }}
        <button
          v-if="i < selectedIds.length - 1"
          type="button"
          data-move="later"
          :disabled="disabled"
          class="-my-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-indigo-200 disabled:cursor-not-allowed"
          :aria-label="`Move ${selectedLabels[id] ?? id} later`"
          @click="moveChip(i, 1)"
        >
          <span aria-hidden="true">&rsaquo;</span>
        </button>
        <button
          type="button"
          :disabled="disabled"
          class="-my-1 ml-0.5 flex h-6 w-6 items-center justify-center rounded-full hover:bg-indigo-200 disabled:cursor-not-allowed"
          :aria-label="`Remove ${selectedLabels[id] ?? id}`"
          @click="removeItem(id)"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </span>
    </div>

    <!-- Single chip — one-to-one -->
    <div
      v-else-if="!isMulti && selectedIds.length"
      class="mt-1.5"
    >
      <span
        class="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800"
      >
        {{ selectedLabels[singleId] ?? singleId }}
        <button
          type="button"
          :disabled="disabled"
          class="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-indigo-200 disabled:cursor-not-allowed"
          aria-label="Clear selection"
          @click="removeItem(singleId)"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </span>
    </div>

    <!-- X / Y counter when a max is configured -->
    <p
      v-if="maxItems !== null"
      class="mt-0.5 text-xs text-gray-500"
    >
      {{ selectedIds.length }} / {{ maxItems }} selected
    </p>

    <!-- Search input -->
    <div class="relative mt-1">
      <input
        :id="field.name"
        type="text"
        :value="query"
        :disabled="disabled || atLimit"
        :placeholder="atLimit ? 'Limit reached' : `Search ${field.label}…`"
        :class="[
          'block w-full rounded-[11px] border px-3.5 py-3 text-sm focus:outline-none focus:ring-[3px]',
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
              : 'border-[#E4E3EE] bg-[#FBFBFD] focus:border-indigo-400 focus:bg-white focus:ring-indigo-50',
          (disabled || atLimit) && 'cursor-not-allowed bg-gray-50 opacity-60',
        ]"
        autocomplete="off"
        @input="onInput"
        @focus="onFocus"
        @focusout="onFocusOut"
      />

      <!-- Dropdown -->
      <ul
        v-if="showDropdown"
        role="listbox"
        class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none"
      >
        <!-- Loading spinner -->
        <li v-if="loading" class="flex items-center gap-2 px-3 py-2 text-gray-400">
          <span
            class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
            aria-hidden="true"
          />
          Searching…
        </li>

        <template v-else>
          <!-- No results -->
          <li
            v-if="results.length === 0"
            class="px-3 py-2 text-gray-500"
          >
            No results found for "{{ query }}"
          </li>

          <!-- Result items -->
          <li
            v-for="item in results"
            :key="String(item.id)"
            role="option"
            class="cursor-pointer px-3 py-2 hover:bg-indigo-50"
            @mousedown.prevent
            @click="selectItem(item)"
          >
            {{ labelFor(item) }}
          </li>
        </template>
      </ul>
    </div>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
