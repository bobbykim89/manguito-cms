<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { MediaItem } from '@bobbykim/manguito-cms-core'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useNotification } from '../../composables/useNotification'
import { useUiStore } from '../../stores/ui'
import { useMediaStore } from '../../stores/media'
import Pagination from '../../components/shared/Pagination.vue'
import ConfirmDialog from '../../components/shared/ConfirmDialog.vue'

const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const notify = useNotification()
const uiStore = useUiStore()
const mediaStore = useMediaStore()

// ── Tab state ─────────────────────────────────────────────────────────────────

type MediaTab = 'all' | 'image' | 'video' | 'file' | 'orphaned'

const activeTab = ref<MediaTab>('all')
const isOrphanedTab = computed(() => activeTab.value === 'orphaned')

const TABS: { value: MediaTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'file', label: 'PDFs' },
  { value: 'orphaned', label: 'Orphaned' },
]

// ── Grid data ─────────────────────────────────────────────────────────────────

const items = ref<MediaItem[]>([])
const total = ref(0)
const page = ref(1)
const PER_PAGE = 20
const loading = ref(false)

function buildPath(tab: MediaTab, p: number): string {
  const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) })
  if (tab === 'orphaned') {
    params.set('orphaned', 'true')
  } else if (tab !== 'all') {
    params.set('type', tab)
  }
  return `/media?${params.toString()}`
}

async function loadPage(tab: MediaTab, p: number) {
  loading.value = true
  const res = await api.get<MediaItem[]>(buildPath(tab, p))
  loading.value = false
  if (res.ok) {
    items.value = res.data
    const raw = res as unknown as { meta?: { total: number } }
    total.value = raw.meta?.total ?? res.data.length
    mediaStore.setItems(res.data)
  }
}

onMounted(() => { void loadPage(activeTab.value, page.value) })

watch(activeTab, (tab) => {
  page.value = 1
  selectedIds.value.clear()
  void loadPage(tab, 1)
})

function onPageChange(p: number) {
  page.value = p
  void loadPage(activeTab.value, p)
}

// ── Navigation ────────────────────────────────────────────────────────────────

function goToDetail(id: string) {
  void router.push({ name: 'media-detail', params: { id } })
}

// ── Bulk delete (orphaned tab only) ───────────────────────────────────────────

const selectedIds = ref(new Set<string>())
const showBulkConfirm = ref(false)

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

function toggleSelectAll() {
  if (selectedIds.value.size === items.value.length) {
    selectedIds.value.clear()
  } else {
    selectedIds.value = new Set(items.value.map(i => i.id))
  }
}

async function doBulkDelete() {
  showBulkConfirm.value = false
  const ids = [...selectedIds.value]
  for (const id of ids) {
    await api.del(`/media/${id}`)
    mediaStore.removeItem(id)
  }
  items.value = items.value.filter(i => !ids.includes(i.id))
  total.value = Math.max(0, total.value - ids.length)
  selectedIds.value.clear()
  notify.success(`Deleted ${ids.length} item${ids.length !== 1 ? 's' : ''}.`)
}

// ── Upload flow ───────────────────────────────────────────────────────────────

type UploadPhase = 'idle' | 'alt-collect' | 'uploading'

const uploadPhase = ref<UploadPhase>('idle')
const pendingFile = ref<File | null>(null)
const pendingMediaType = ref<'image' | 'video' | 'file'>('file')
const altText = ref('')
const uploadProgress = ref(0)
const uploadError = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

function detectMediaType(file: File): 'image' | 'video' | 'file' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(e.target as HTMLInputElement).value = ''

  pendingFile.value = file
  pendingMediaType.value = detectMediaType(file)
  altText.value = ''
  uploadError.value = ''

  if (pendingMediaType.value !== 'image') {
    // Video / file: collect required alt before upload.
    uploadPhase.value = 'alt-collect'
  } else {
    void startUpload(file)
  }
}

function uploadDirect(file: File, alt: string): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    if (alt) form.append('alt', alt)

    const xhr = new XMLHttpRequest()
    xhr.withCredentials = true
    xhr.open('POST', `${__ADMIN_PREFIX__}/api/media/${pendingMediaType.value}`)

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        uploadProgress.value = Math.round((ev.loaded / ev.total) * 100)
      }
    }

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as { ok: boolean; data?: MediaItem; error?: { message: string } }
        json.ok && json.data ? resolve(json.data) : reject(new Error(json.error?.message ?? 'Upload failed'))
      } catch {
        reject(new Error('Invalid server response'))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

async function uploadPresigned(file: File, alt: string): Promise<MediaItem> {
  const params = new URLSearchParams({ type: pendingMediaType.value, filename: file.name, mime_type: file.type })
  const presignedRes = await fetch(`${__ADMIN_PREFIX__}/api/media/presigned-url?${params.toString()}`, { credentials: 'include' })
  const presignedJson = await presignedRes.json() as { ok: boolean; data?: { upload_url: string; media_id: string }; error?: { message: string } }
  if (!presignedJson.ok || !presignedJson.data) throw new Error(presignedJson.error?.message ?? 'Failed to get upload URL')

  const { upload_url, media_id } = presignedJson.data

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', upload_url)
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) uploadProgress.value = Math.round((ev.loaded / ev.total) * 100)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(file)
  })

  const confirmRes = await fetch(`${__ADMIN_PREFIX__}/api/media/confirm/${media_id}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alt }),
  })
  const confirmJson = await confirmRes.json() as { ok: boolean; data?: MediaItem; error?: { message: string } }
  if (!confirmJson.ok || !confirmJson.data) throw new Error(confirmJson.error?.message ?? 'Upload confirmation failed')
  return confirmJson.data
}

async function startUpload(file: File) {
  uploadPhase.value = 'uploading'
  uploadProgress.value = 0
  uploadError.value = ''

  try {
    const alt = altText.value.trim()
    const newItem = file.size <= uiStore.maxFileSize
      ? await uploadDirect(file, alt)
      : await uploadPresigned(file, alt)

    items.value = [newItem, ...items.value]
    total.value += 1
    mediaStore.setItem(newItem)
    notify.success('Upload complete.')
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : 'Upload failed'
  } finally {
    uploadPhase.value = 'idle'
    pendingFile.value = null
  }
}

function startUploadFromForm() {
  if (!pendingFile.value) return
  void startUpload(pendingFile.value)
}

function cancelUpload() {
  pendingFile.value = null
  altText.value = ''
  uploadError.value = ''
  uploadPhase.value = 'idle'
}
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="mb-5 flex items-center justify-between gap-4">
      <h1 class="text-xl font-semibold text-gray-900">Media library</h1>

      <!-- Upload button -->
      <div v-if="can('media:create')">
        <input
          ref="fileInputRef"
          type="file"
          class="hidden"
          accept="image/*,video/*,application/pdf,.pdf"
          @change="onFileSelected"
        />
        <button
          type="button"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          @click="fileInputRef?.click()"
        >
          Upload
        </button>
      </div>
    </div>

    <!-- Upload progress panel -->
    <div
      v-if="uploadPhase !== 'idle'"
      class="mb-5 rounded-md border border-gray-200 bg-white p-4 shadow-sm"
    >
      <!-- Alt text collection for video / file -->
      <div v-if="uploadPhase === 'alt-collect'" class="space-y-3">
        <p class="text-sm font-medium text-gray-700">{{ pendingFile?.name }}</p>
        <div>
          <label for="upload-alt" class="block text-xs text-gray-600">
            Alt text <span class="text-red-500">*</span>
          </label>
          <input
            id="upload-alt"
            v-model="altText"
            type="text"
            placeholder="Describe this file"
            class="mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            @click="cancelUpload"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="!altText.trim()"
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            @click="startUploadFromForm"
          >
            Upload
          </button>
        </div>
      </div>

      <!-- Upload in progress -->
      <div v-else-if="uploadPhase === 'uploading'" class="space-y-2">
        <p class="text-sm text-gray-500">Uploading{{ pendingFile ? ` ${pendingFile.name}` : '…' }}</p>
        <div class="flex items-center gap-2">
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-2 rounded-full bg-indigo-600 transition-all duration-150"
              :style="{ width: `${uploadProgress}%` }"
            />
          </div>
          <span class="w-8 shrink-0 text-right text-xs text-gray-500">{{ uploadProgress }}%</span>
        </div>
      </div>

      <p v-if="uploadError" class="mt-2 text-sm text-red-600" role="alert">{{ uploadError }}</p>
    </div>

    <!-- Tab bar -->
    <div class="mb-4 flex items-center gap-1 border-b border-gray-200">
      <button
        v-for="tab in TABS"
        :key="tab.value"
        type="button"
        :class="[
          'px-3 py-2 text-sm font-medium transition-colors',
          activeTab === tab.value
            ? 'border-b-2 border-indigo-600 text-indigo-600'
            : 'text-gray-500 hover:text-gray-800',
        ]"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Bulk delete toolbar (orphaned tab) -->
    <div
      v-if="isOrphanedTab && items.length > 0 && can('media:delete')"
      class="mb-3 flex items-center gap-3"
    >
      <label class="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          :checked="selectedIds.size === items.length && items.length > 0"
          :indeterminate="selectedIds.size > 0 && selectedIds.size < items.length"
          class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          @change="toggleSelectAll"
        />
        Select all
      </label>
      <button
        v-if="selectedIds.size > 0"
        type="button"
        class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        @click="showBulkConfirm = true"
      >
        Delete {{ selectedIds.size }} selected
      </button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      <div
        v-for="n in 12"
        :key="n"
        class="aspect-square animate-pulse rounded-md bg-gray-100"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="items.length === 0"
      class="rounded-lg border border-dashed border-gray-300 p-12 text-center"
    >
      <p class="text-sm text-gray-500">
        {{ isOrphanedTab ? 'No orphaned files.' : 'No media files yet.' }}
      </p>
    </div>

    <!-- Media grid -->
    <div
      v-else
      class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="group relative aspect-square"
      >
        <!-- Selection checkbox (orphaned tab only) -->
        <label
          v-if="isOrphanedTab && can('media:delete')"
          class="absolute left-1.5 top-1.5 z-10 cursor-pointer"
          @click.stop
        >
          <input
            type="checkbox"
            :checked="selectedIds.has(item.id)"
            class="rounded border-gray-300 bg-white text-indigo-600 shadow focus:ring-indigo-500"
            @change="toggleSelect(item.id)"
          />
        </label>

        <!-- Clickable item card -->
        <button
          type="button"
          class="h-full w-full overflow-hidden rounded-md border-2 border-transparent transition-colors hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          :aria-label="`View ${item.alt ?? item.url.split('/').pop()}`"
          @click="goToDetail(item.id)"
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
            class="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-50 p-1 text-gray-400"
          >
            <span class="text-3xl" aria-hidden="true">
              {{ item.type === 'video' ? '▶' : '📄' }}
            </span>
            <span class="max-w-full truncate text-center text-xs">
              {{ item.url.split('/').pop() }}
            </span>
            <span class="text-xs text-gray-300">{{ formatSize(item.file_size) }}</span>
          </div>
        </button>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="!loading && total > PER_PAGE" class="mt-5 flex justify-center">
      <Pagination
        :total="total"
        :page="page"
        :per-page="PER_PAGE"
        @update:page="onPageChange"
      />
    </div>

    <!-- Bulk delete confirmation -->
    <ConfirmDialog
      v-if="showBulkConfirm"
      :message="`Permanently delete ${selectedIds.size} file${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`"
      :on-confirm="doBulkDelete"
      :on-cancel="() => (showBulkConfirm = false)"
    />
  </div>
</template>
