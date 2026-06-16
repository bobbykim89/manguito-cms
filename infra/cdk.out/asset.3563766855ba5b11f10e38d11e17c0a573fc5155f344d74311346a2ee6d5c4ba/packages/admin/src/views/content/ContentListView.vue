<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
  const cached = contentStore.getPage(type.value, p, DEFAULT_PAGE_SIZE)
  if (cached) {
    items.value = cached as Record<string, unknown>[]
    total.value = contentStore.total
    loading.value = false
    return
  }

  const res = await api.get<Record<string, unknown>[]>(
    `/content/${type.value}?page=${p}&per_page=${DEFAULT_PAGE_SIZE}`
  )
  loading.value = false

  if (res.ok) {
    items.value = res.data
    const raw = res as unknown as { meta?: { total: number } }
    total.value = raw.meta?.total ?? res.data.length
    contentStore.total = total.value
    contentStore.setPage(type.value, p, DEFAULT_PAGE_SIZE, res.data)
  }
}

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
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">{{ contentType.label }}</h1>
      <button
        v-if="can('content:create')"
        type="button"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        @click="goToCreate"
      >
        New {{ contentType.label }}
      </button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-2">
      <div
        v-for="n in 8"
        :key="n"
        class="h-12 animate-pulse rounded-md bg-gray-100"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="items.length === 0"
      class="rounded-lg border border-dashed border-gray-300 p-12 text-center"
    >
      <p class="text-sm text-gray-500">No {{ contentType.label }} items yet.</p>
      <button
        v-if="can('content:create')"
        type="button"
        class="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        @click="goToCreate"
      >
        Create the first one →
      </button>
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden rounded-lg border border-gray-200">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-3 text-left">Title</th>
            <th class="px-4 py-3 text-left">Slug</th>
            <th class="px-4 py-3 text-left">Status</th>
            <th class="px-4 py-3 text-left">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="item in items"
            :key="String(item.id)"
            class="cursor-pointer hover:bg-gray-50"
            @click="goToEdit(item)"
          >
            <td class="px-4 py-3 font-medium text-gray-900">
              {{ item[titleField] ?? '—' }}
            </td>
            <td class="px-4 py-3 font-mono text-gray-500">
              {{ item.slug ?? '—' }}
            </td>
            <td class="px-4 py-3">
              <StatusBadge :published="item.published === true" />
            </td>
            <td class="px-4 py-3 text-gray-500">
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
