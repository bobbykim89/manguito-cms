<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useSchemaStore } from '../../stores/schema'
import { useTaxonomyStore, DEFAULT_PAGE_SIZE } from '../../stores/taxonomy'
import Pagination from '../../components/shared/Pagination.vue'

const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const schemaStore = useSchemaStore()
const taxonomyStore = useTaxonomyStore()

const type = computed(() => route.params.type as string)
const taxonomyType = computed(() => schemaStore.taxonomyTypes[type.value])

// First text/plain field — used as the title column.
const titleField = computed(
  () => taxonomyType.value?.fields.find(f => f.field_type === 'text/plain')?.name ?? 'id'
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
  const cached = taxonomyStore.getPage(type.value, p, DEFAULT_PAGE_SIZE)
  if (cached) {
    items.value = cached as Record<string, unknown>[]
    total.value = taxonomyStore.total
    loading.value = false
    return
  }

  const res = await api.get<Record<string, unknown>[]>(
    `/taxonomy/${type.value}?page=${p}&per_page=${DEFAULT_PAGE_SIZE}`
  )
  loading.value = false

  if (res.ok) {
    items.value = res.data
    const raw = res as unknown as { meta?: { total: number } }
    total.value = raw.meta?.total ?? res.data.length
    taxonomyStore.total = total.value
    taxonomyStore.setPage(type.value, p, DEFAULT_PAGE_SIZE, res.data)
  }
}

onMounted(() => { void loadPage(page.value) })

watch(type, () => {
  page.value = 1
  items.value = []
  void loadPage(1)
})

function onPageChange(p: number) {
  page.value = p
  void loadPage(p)
}

function goToEdit(item: Record<string, unknown>) {
  void router.push({
    name: 'taxonomy-edit',
    params: { type: type.value, id: String(item.id) },
  })
}

function goToCreate() {
  void router.push({ name: 'taxonomy-new', params: { type: type.value } })
}
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="mb-5.5 flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-[26px] font-bold tracking-tight text-ink">
        {{ taxonomyType?.label ?? type }}
      </h1>
      <button
        v-if="can('taxonomy:create')"
        type="button"
        class="inline-flex items-center gap-1.75 rounded-[11px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_3px_10px_rgba(91,87,232,0.3)] transition-all hover:bg-indigo-700 hover:shadow-[0_6px_18px_rgba(91,87,232,0.4)]"
        @click="goToCreate"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        New {{ taxonomyType?.label ?? 'Term' }}
      </button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-2">
      <div
        v-for="n in 6"
        :key="n"
        class="h-12 animate-pulse rounded-[10px] bg-gray-100"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="items.length === 0"
      class="rounded-2xl border border-dashed border-gray-300 p-12 text-center"
    >
      <p class="text-sm text-muted">No terms yet.</p>
      <button
        v-if="can('taxonomy:create')"
        type="button"
        class="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        @click="goToCreate"
      >
        Create the first one →
      </button>
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden rounded-2xl border border-card-border bg-white shadow-[0_1px_2px_rgba(24,24,48,0.04),0_10px_28px_rgba(24,24,48,0.04)]">
      <table class="w-full text-sm">
        <thead class="text-[11.5px] font-bold uppercase tracking-[.06em] text-faint">
          <tr class="border-b border-divider">
            <th class="px-5.5 py-3.5 text-left">Name</th>
            <th class="px-5.5 py-3.5 text-left">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#F4F3F9]">
          <tr
            v-for="item in items"
            :key="String(item.id)"
            class="cursor-pointer transition-colors hover:bg-[#FAFAFE]"
            @click="goToEdit(item)"
          >
            <td class="px-5.5 py-4 text-[14.5px] font-semibold text-ink">
              {{ item[titleField] ?? '—' }}
            </td>
            <td class="px-5.5 py-4 text-[13px] text-faint">
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
