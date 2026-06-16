<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { MediaItem } from '@bobbykim/manguito-cms-core'
import { useApiClient } from '../../composables/useApiClient'

type MediaType = 'image' | 'video' | 'file'

const props = defineProps<{
  // When set, the filter tab is locked to this type.
  acceptedType?: MediaType
}>()

const emit = defineEmits<{
  select: [item: MediaItem]
  close: []
}>()

const api = useApiClient()

// ── Filter tabs ───────────────────────────────────────────────────────────────

type Tab = { label: string; value: MediaType | 'all' }

const ALL_TABS: Tab[] = [
  { label: 'Images', value: 'image' },
  { label: 'Videos', value: 'video' },
  { label: 'PDFs', value: 'file' },
]

const activeTab = ref<MediaType | 'all'>(props.acceptedType ?? 'all')
const tabsVisible = computed(() => !props.acceptedType)

// When acceptedType changes (unlikely at runtime, but defensive), sync.
watch(
  () => props.acceptedType,
  (t) => { if (t) activeTab.value = t }
)

// ── Data ──────────────────────────────────────────────────────────────────────

const items = ref<MediaItem[]>([])
const loading = ref(false)
const page = ref(1)
const totalPages = ref(1)
const selectedItem = ref<MediaItem | null>(null)

function buildPath(tab: MediaType | 'all', p: number): string {
  const params = new URLSearchParams({ page: String(p), per_page: '20' })
  if (tab !== 'all') params.set('type', tab)
  return `/media?${params.toString()}`
}

async function fetchMedia() {
  loading.value = true
  const res = await api.get<MediaItem[]>(buildPath(activeTab.value, page.value))
  loading.value = false

  if (res.ok) {
    items.value = res.data

    // The server also returns meta — access it via type assertion since
    // ApiResult<T> doesn't model the extra fields.
    const raw = res as unknown as { meta?: { total_pages: number } }
    totalPages.value = raw.meta?.total_pages ?? 1
  }
}

watch(activeTab, () => {
  page.value = 1
  selectedItem.value = null
  void fetchMedia()
})

watch(page, () => {
  void fetchMedia()
})

onMounted(() => { void fetchMedia() })

// ── Actions ───────────────────────────────────────────────────────────────────

function confirm() {
  if (!selectedItem.value) return
  emit('select', selectedItem.value)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Select media"
      @click.self="$emit('close')"
    >
      <div class="flex h-full max-h-144 w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 class="text-base font-semibold text-gray-900">Select Media</h2>
          <button
            type="button"
            class="text-xl leading-none text-gray-400 hover:text-gray-600"
            aria-label="Close"
            @click="$emit('close')"
          >
            &times;
          </button>
        </div>

        <!-- Filter tabs — hidden when type is locked -->
        <div
          v-if="tabsVisible"
          class="flex gap-1 border-b border-gray-200 px-5 pt-3"
        >
          <button
            type="button"
            :class="[
              'rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'all'
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-500 hover:text-gray-800',
            ]"
            @click="activeTab = 'all'"
          >
            All
          </button>
          <button
            v-for="tab in ALL_TABS"
            :key="tab.value"
            type="button"
            :class="[
              'rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab.value
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-500 hover:text-gray-800',
            ]"
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Locked tab label -->
        <div
          v-else
          class="border-b border-gray-200 px-5 py-2 text-sm text-gray-500"
        >
          Showing:
          <span class="font-medium text-gray-700">
            {{ ALL_TABS.find(t => t.value === acceptedType)?.label ?? acceptedType }}
          </span>
        </div>

        <!-- Grid -->
        <div class="flex-1 overflow-y-auto p-5">
          <!-- Loading -->
          <div v-if="loading" class="flex items-center justify-center py-16">
            <span
              class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
              aria-hidden="true"
            />
          </div>

          <!-- Empty state -->
          <div
            v-else-if="items.length === 0"
            class="flex flex-col items-center justify-center py-16 text-gray-400"
          >
            <span class="text-4xl" aria-hidden="true">🖼</span>
            <p class="mt-2 text-sm">No media found</p>
          </div>

          <!-- Media grid -->
          <div
            v-else
            class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5"
          >
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              :class="[
                'group relative aspect-square overflow-hidden rounded-md border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
                selectedItem?.id === item.id
                  ? 'border-indigo-500'
                  : 'border-transparent hover:border-gray-300',
              ]"
              :aria-pressed="selectedItem?.id === item.id"
              :aria-label="`Select ${item.alt ?? item.url.split('/').pop()}`"
              @click="selectedItem = item"
            >
              <!-- Image thumbnail -->
              <img
                v-if="item.type === 'image'"
                :src="item.url"
                :alt="item.alt ?? ''"
                class="h-full w-full object-cover"
                loading="lazy"
              />

              <!-- Video / file icon -->
              <div
                v-else
                class="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-50 text-gray-400"
                aria-hidden="true"
              >
                <span class="text-3xl">{{ item.type === 'video' ? '▶' : '📄' }}</span>
                <span class="max-w-full truncate px-1 text-xs">
                  {{ item.url.split('/').pop() }}
                </span>
              </div>

              <!-- Selection overlay tick -->
              <div
                v-if="selectedItem?.id === item.id"
                class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white"
                aria-hidden="true"
              >
                ✓
              </div>
            </button>
          </div>
        </div>

        <!-- Pagination -->
        <div
          v-if="totalPages > 1"
          class="flex items-center justify-center gap-3 border-t border-gray-100 px-5 py-2"
        >
          <button
            type="button"
            :disabled="page === 1"
            class="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            @click="page--"
          >
            ← Prev
          </button>
          <span class="text-xs text-gray-500">{{ page }} / {{ totalPages }}</span>
          <button
            type="button"
            :disabled="page === totalPages"
            class="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            @click="page++"
          >
            Next →
          </button>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-3 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            @click="$emit('close')"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="!selectedItem"
            class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            @click="confirm"
          >
            Select
          </button>
        </div>

      </div>
    </div>
  </Teleport>
</template>
