<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useSchemaStore } from '../../stores/schema'
import { useContentStore, DEFAULT_PAGE_SIZE } from '../../stores/content'
import Pagination from '../../components/shared/Pagination.vue'
import StatusBadge from '../../components/shared/StatusBadge.vue'

const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const schemaStore = useSchemaStore()
const contentStore = useContentStore()

const type = computed(() => route.params.type as string)
const contentType = computed(() => schemaStore.contentTypes[type.value])
const isSingleton = computed(() => contentType.value?.only_one === true)

// First text/plain field — used as the title column.
const titleField = computed(
  () => contentType.value?.fields.find(f => f.field_type === 'text/plain')?.name ?? 'id'
)

const items = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const search = ref('')

function formatDate(val: unknown): string {
  if (typeof val !== 'string' || !val) return '—'
  return new Date(val).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

async function loadPage(p: number) {
  loading.value = true

  const term = search.value.trim()
  // Search has no place in the page cache's key — bypass it and hit the API directly.
  if (term === '') {
    const cached = contentStore.getPage(type.value, p, DEFAULT_PAGE_SIZE)
    if (cached) {
      items.value = cached as Record<string, unknown>[]
      total.value = contentStore.total
      loading.value = false
      return
    }
  }

  const searchParam = term !== '' ? `&search=${encodeURIComponent(term)}` : ''
  const res = await api.get<Record<string, unknown>[]>(
    `/content/${type.value}?page=${p}&per_page=${DEFAULT_PAGE_SIZE}${searchParam}`
  )
  loading.value = false

  if (res.ok) {
    items.value = res.data
    const raw = res as unknown as { meta?: { total: number } }
    total.value = raw.meta?.total ?? res.data.length
    if (term === '') {
      contentStore.total = total.value
      contentStore.setPage(type.value, p, DEFAULT_PAGE_SIZE, res.data)
    }
  }
}

const onSearchInput = useDebounceFn(() => {
  page.value = 1
  void loadPage(1)
}, 300)

async function handleSingletonRedirect() {
  const res = await api.get<Record<string, unknown>[]>(`/content/${type.value}`)
  const first = res.ok ? res.data[0] : undefined
  if (first) {
    void router.replace({
      name: 'content-edit',
      params: { type: type.value, id: String(first.id) },
    })
  } else {
    void router.replace({ name: 'content-new', params: { type: type.value } })
  }
}

onMounted(async () => {
  if (!contentType.value) return
  if (isSingleton.value) {
    await handleSingletonRedirect()
    return
  }
  await loadPage(page.value)
})

// Re-fetch when type changes (sidebar nav between content types).
watch(type, async () => {
  page.value = 1
  items.value = []
  if (!contentType.value) return
  if (isSingleton.value) {
    await handleSingletonRedirect()
    return
  }
  await loadPage(1)
})

function onPageChange(p: number) {
  page.value = p
  void loadPage(p)
}

function goToEdit(item: Record<string, unknown>) {
  void router.push({
    name: 'content-edit',
    params: { type: type.value, id: String(item.id) },
  })
}

function goToCreate() {
  void router.push({ name: 'content-new', params: { type: type.value } })
}
</script>

<template>
  <!-- Loading / redirect for singleton — blank while redirect fires -->
  <div v-if="isSingleton || !contentType" />

  <div v-else>
    <!-- Page header -->
    <div class="mb-[22px] flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-[26px] font-bold tracking-tight text-ink">{{ contentType.label }}</h1>
      <button
        v-if="can('content:create')"
        type="button"
        class="inline-flex items-center gap-[7px] rounded-[11px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_3px_10px_rgba(91,87,232,0.3)] transition-all hover:bg-indigo-700 hover:shadow-[0_6px_18px_rgba(91,87,232,0.4)]"
        @click="goToCreate"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        New {{ contentType.label }}
      </button>
    </div>

    <!-- Search -->
    <div class="mb-4 flex h-[38px] items-center gap-2 rounded-[10px] border border-card-border bg-[#FBFBFD] px-[11px] text-[13px] transition-colors focus-within:border-indigo-400">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-faint">
        <path d="M21 21l-4.3-4.3" /><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      </svg>
      <input
        v-model="search"
        type="text"
        :placeholder="`Search ${contentType.label.toLowerCase()}…`"
        class="w-full bg-transparent text-ink outline-none placeholder:text-faint"
        @input="onSearchInput"
      />
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-2">
      <div
        v-for="n in 8"
        :key="n"
        class="h-12 animate-pulse rounded-[10px] bg-gray-100"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="items.length === 0"
      class="rounded-[16px] border border-dashed border-gray-300 p-12 text-center"
    >
      <p class="text-sm text-muted">
        {{ search.trim() !== '' ? `No results for “${search.trim()}”.` : `No ${contentType.label} items yet.` }}
      </p>
      <button
        v-if="can('content:create') && search.trim() === ''"
        type="button"
        class="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        @click="goToCreate"
      >
        Create the first one →
      </button>
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden rounded-[16px] border border-card-border bg-white shadow-[0_1px_2px_rgba(24,24,48,0.04),0_10px_28px_rgba(24,24,48,0.04)]">
      <table class="w-full text-sm">
        <thead class="text-[11.5px] font-bold uppercase tracking-[.06em] text-faint">
          <tr class="border-b border-divider">
            <th class="px-[22px] py-3.5 text-left">Title</th>
            <th class="px-[22px] py-3.5 text-left">Slug</th>
            <th class="px-[22px] py-3.5 text-left">Status</th>
            <th class="px-[22px] py-3.5 text-left">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#F4F3F9]">
          <tr
            v-for="item in items"
            :key="String(item.id)"
            class="cursor-pointer transition-colors hover:bg-[#FAFAFE]"
            @click="goToEdit(item)"
          >
            <td class="px-[22px] py-4 text-[14.5px] font-semibold text-ink">
              {{ item[titleField] ?? '—' }}
            </td>
            <td class="px-[22px] py-4 font-mono text-[12.5px] text-muted">
              {{ item.slug ?? '—' }}
            </td>
            <td class="px-[22px] py-4">
              <StatusBadge :published="item.published === true" />
            </td>
            <td class="px-[22px] py-4 text-[13px] text-faint">
              {{ formatDate(item.updated_at) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="!loading && total > DEFAULT_PAGE_SIZE" class="mt-4 flex justify-center">
      <Pagination
        :total="total"
        :page="page"
        :per-page="DEFAULT_PAGE_SIZE"
        @update:page="onPageChange"
      />
    </div>
  </div>
</template>
