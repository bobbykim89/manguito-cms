<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  total: number
  page: number
  perPage: number
}>()

const emit = defineEmits<{
  'update:page': [page: number]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.perPage)))

// Sliding-window range: always show first + last, ±1 around current, null = ellipsis.
const pageRange = computed<(number | null)[]>(() => {
  const t = totalPages.value
  const c = props.page

  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)

  const pages: (number | null)[] = [1]
  if (c > 3) pages.push(null)

  const start = Math.max(2, c - 1)
  const end = Math.min(t - 1, c + 1)
  for (let i = start; i <= end; i++) pages.push(i)

  if (c < t - 2) pages.push(null)
  pages.push(t)

  return pages
})

function go(p: number) {
  if (p < 1 || p > totalPages.value || p === props.page) return
  emit('update:page', p)
}
</script>

<template>
  <nav
    v-if="totalPages > 1"
    class="flex items-center gap-1"
    aria-label="Pagination"
  >
    <button
      type="button"
      class="rounded px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="page === 1"
      aria-label="Previous page"
      @click="go(page - 1)"
    >
      &lsaquo;
    </button>

    <template v-for="(item, i) in pageRange" :key="i">
      <span
        v-if="item === null"
        class="px-1.5 py-1.5 text-sm text-gray-400"
        aria-hidden="true"
      >
        &hellip;
      </span>
      <button
        v-else
        type="button"
        :aria-label="`Page ${item}`"
        :aria-current="item === page ? 'page' : undefined"
        :class="[
          'min-w-8 rounded px-2.5 py-1.5 text-sm font-medium',
          item === page
            ? 'bg-indigo-600 text-white'
            : 'text-gray-600 hover:bg-gray-100',
        ]"
        @click="go(item)"
      >
        {{ item }}
      </button>
    </template>

    <button
      type="button"
      class="rounded px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="page === totalPages"
      aria-label="Next page"
      @click="go(page + 1)"
    >
      &rsaquo;
    </button>
  </nav>
</template>
