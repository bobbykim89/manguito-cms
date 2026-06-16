<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MediaItem } from '@bobbykim/manguito-cms-core'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useNotification } from '../../composables/useNotification'
import { useMediaStore } from '../../stores/media'
import ConfirmDialog from '../../components/shared/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const notify = useNotification()
const mediaStore = useMediaStore()

const id = computed(() => route.params.id as string)

const item = ref<MediaItem | null>(null)
const loading = ref(true)
const altText = ref('')
const savingAlt = ref(false)
const deleting = ref(false)
const showDeleteConfirm = ref(false)

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

function formatDate(dateStr: string | Date | unknown): string {
  if (!dateStr) return '—'
  return new Date(String(dateStr)).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

onMounted(async () => {
  const cached = mediaStore.items.get(id.value)
  if (cached) {
    item.value = cached
    altText.value = cached.alt ?? ''
    loading.value = false
    return
  }

  const res = await api.get<MediaItem>(`/media/${id.value}`)
  loading.value = false
  if (res.ok) {
    item.value = res.data
    altText.value = res.data.alt ?? ''
    mediaStore.setItem(res.data)
  }
})

async function saveAlt() {
  if (!item.value) return
  savingAlt.value = true
  const res = await api.patch<MediaItem>(`/media/${item.value.id}`, { alt: altText.value.trim() })
  savingAlt.value = false
  if (res.ok) {
    item.value = res.data
    mediaStore.setItem(res.data)
    notify.success('Alt text saved.')
  } else {
    notify.error(res.error.message)
  }
}

async function doDelete() {
  if (!item.value) return
  showDeleteConfirm.value = false
  deleting.value = true
  const res = await api.del(`/media/${item.value.id}`)
  deleting.value = false
  if (!res.ok) {
    notify.error((res as { ok: false; error: { message: string } }).error.message)
    return
  }
  mediaStore.removeItem(item.value.id)
  void router.push({ name: 'media-library' })
}

const canDelete = computed(() => item.value !== null && item.value.reference_count === 0)
const deleteTooltip = computed(() =>
  canDelete.value
    ? undefined
    : `This file is referenced by ${item.value?.reference_count ?? 0} item${(item.value?.reference_count ?? 0) !== 1 ? 's' : ''} and cannot be deleted.`
)
</script>

<template>
  <!-- Loading -->
  <div v-if="loading" class="flex items-center justify-center py-20">
    <span
      class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
      aria-hidden="true"
    />
  </div>

  <div v-else-if="!item" class="py-12 text-center text-sm text-gray-500">
    Media item not found.
  </div>

  <div v-else class="mx-auto max-w-2xl space-y-6">
    <!-- Back link -->
    <button
      type="button"
      class="text-sm text-indigo-600 hover:text-indigo-800"
      @click="router.back()"
    >
      ← Back to library
    </button>

    <!-- Preview -->
    <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <img
        v-if="item.type === 'image'"
        :src="item.url"
        :alt="item.alt ?? ''"
        class="max-h-96 w-full object-contain"
      />
      <div
        v-else
        class="flex h-48 items-center justify-center text-6xl text-gray-300"
        aria-hidden="true"
      >
        {{ item.type === 'video' ? '▶' : '📄' }}
      </div>
    </div>

    <!-- Metadata -->
    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Metadata</h2>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt class="text-gray-500">Type</dt>
          <dd class="mt-0.5 font-medium text-gray-800">{{ item.mime_type }}</dd>
        </div>
        <div>
          <dt class="text-gray-500">Size</dt>
          <dd class="mt-0.5 font-medium text-gray-800">{{ formatSize(item.file_size) }}</dd>
        </div>
        <div v-if="item.width && item.height">
          <dt class="text-gray-500">Dimensions</dt>
          <dd class="mt-0.5 font-medium text-gray-800">{{ item.width }} × {{ item.height }}px</dd>
        </div>
        <div v-if="item.duration">
          <dt class="text-gray-500">Duration</dt>
          <dd class="mt-0.5 font-medium text-gray-800">{{ item.duration }}s</dd>
        </div>
        <div>
          <dt class="text-gray-500">Uploaded</dt>
          <dd class="mt-0.5 font-medium text-gray-800">{{ formatDate(item.created_at) }}</dd>
        </div>
        <div>
          <dt class="text-gray-500">References</dt>
          <dd class="mt-0.5 font-medium text-gray-800">
            {{ item.reference_count }} content item{{ item.reference_count !== 1 ? 's' : '' }}
          </dd>
        </div>
      </dl>
    </div>

    <!-- Alt text -->
    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Alt text</h2>
      <textarea
        v-model="altText"
        rows="3"
        :disabled="savingAlt"
        placeholder="Describe this file for screen readers and SEO"
        class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div class="mt-3 flex justify-end">
        <button
          type="button"
          :disabled="savingAlt"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="saveAlt"
        >
          {{ savingAlt ? 'Saving…' : 'Save alt text' }}
        </button>
      </div>
    </div>

    <!-- Danger zone -->
    <div v-if="can('media:delete')" class="rounded-lg border border-red-200 bg-white p-5">
      <h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-red-500">Danger zone</h2>
      <p class="mb-3 text-sm text-gray-500">
        Permanently deletes this file from storage. This cannot be undone.
      </p>

      <!-- Wrapper needed for title on a disabled button in some browsers -->
      <span :title="deleteTooltip">
        <button
          type="button"
          :disabled="!canDelete || deleting"
          class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="showDeleteConfirm = true"
        >
          {{ deleting ? 'Deleting…' : 'Delete file' }}
        </button>
      </span>

      <p v-if="!canDelete" class="mt-2 text-xs text-gray-400">
        {{ deleteTooltip }}
      </p>
    </div>

    <!-- Delete confirmation -->
    <ConfirmDialog
      v-if="showDeleteConfirm"
      message="Permanently delete this file? This action cannot be undone."
      :on-confirm="doDelete"
      :on-cancel="() => (showDeleteConfirm = false)"
    />
  </div>
</template>
