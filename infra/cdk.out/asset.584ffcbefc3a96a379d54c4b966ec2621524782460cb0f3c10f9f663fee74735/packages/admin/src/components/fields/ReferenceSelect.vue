<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { useApiClient } from '../../composables/useApiClient'
import { useSchemaStore } from '../../stores/schema'

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
const relType = computed(() => typeaheadComp.value?.rel ?? 'one-to-one')
const maxItems = computed(() => props.field.validation.max_items ?? null)
const isMulti = computed(() => relType.value !== 'one-to-one')
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
    return Array.isArray(props.modelValue)
      ? (props.modelValue as unknown[]).filter((v): v is string => typeof v === 'string')
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

function buildSearchPath(q: string): string {
  const params = new URLSearchParams({
    [`filters[${titleField.value}][like]`]: q,
    per_page: '10',
  })
  return `${basePath()}?${params.toString()}`
}

function labelFor(item: Record<string, unknown>): string {
  return String(item[titleField.value] ?? item.id ?? '')
}

const doSearch = useDebounceFn(async (q: string) => {
  if (q.length < 2) {
    results.value = []
    showDropdown.value = false
    return
  }
  loading.value = true
  showDropdown.value = true
  const res = await api.get<Record<string, unknown>[]>(buildSearchPath(q))
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

// Fetch display labels for any IDs already present when the component mounts.
onMounted(async () => {
  for (const id of selectedIds.value) {
    if (selectedLabels.value[id]) continue
    const res = await api.get<Record<string, unknown>>(`${basePath()}/${id}`)
    if (res.ok) {
      selectedLabels.value[id] = labelFor(res.data as Record<string, unknown>)
    } else {
      selectedLabels.value[id] = id
    }
  }
})
</script>

<template>
  <div>
    <label class="block text-sm font-medium text-gray-700">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <!-- Removable chips — one-to-many / many-to-many -->
    <div
      v-if="isMulti && selectedIds.length"
      class="mt-1.5 flex flex-wrap gap-1.5"
    >
      <span
        v-for="id in selectedIds"
        :key="id"
        class="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800"
      >
        {{ selectedLabels[id] ?? id }}
        <button
          type="button"
          :disabled="disabled"
          class="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-indigo-200 disabled:cursor-not-allowed"
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
          'block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2',
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
            : 'border-gray-300 focus:border-indigo-400 focus:ring-indigo-200',
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
