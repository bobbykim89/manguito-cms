<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import type { MediaItem } from '@bobbykim/manguito-cms-core'
import { useUiStore } from '../../stores/ui'
import MediaSelectModal from '../shared/MediaSelectModal.vue'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const uiStore = useUiStore()

// Narrowed ui_component for accepted MIME types.
const acceptMime = computed(() => {
  const c = props.field.ui_component
  return c.component === 'file-upload' ? c.accepted_mime_types.join(',') : ''
})

const mediaType = computed((): 'image' | 'video' | 'file' => {
  const t = props.field.field_type
  if (t === 'image' || t === 'video' || t === 'file') return t
  return 'file'
})

// Alt text is required for video / file; optional for images.
const altRequired = computed(() => mediaType.value !== 'image')

// ── State ─────────────────────────────────────────────────────────────────────

type UploadPhase = 'idle' | 'alt-collect' | 'uploading'

const uploadPhase = ref<UploadPhase>('idle')
const uploadProgress = ref(0)
const uploadError = ref('')

const pendingFile = ref<File | null>(null)
const altText = ref('')

// Full MediaItem kept for display; modelValue only stores the ID.
const displayItem = ref<MediaItem | null>(null)

const showModal = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

function filenameFrom(url: string): string {
  return url.split('/').pop() ?? url
}

// ── Upload logic (XMLHttpRequest — not useApiClient) ──────────────────────────

function uploadDirect(file: File, alt: string): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    if (alt) form.append('alt', alt)

    const xhr = new XMLHttpRequest()
    xhr.withCredentials = true
    xhr.open('POST', `${__ADMIN_PREFIX__}/api/media/${mediaType.value}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        uploadProgress.value = Math.round((e.loaded / e.total) * 100)
      }
    }

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as {
          ok: boolean
          data?: MediaItem
          error?: { message: string }
        }
        if (json.ok && json.data) {
          resolve(json.data)
        } else {
          reject(new Error(json.error?.message ?? 'Upload failed'))
        }
      } catch {
        reject(new Error('Invalid server response'))
      }
    }

    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

async function uploadPresigned(file: File, alt: string): Promise<MediaItem> {
  // Step 1 — get presigned URL.
  const params = new URLSearchParams({
    type: mediaType.value,
    filename: file.name,
    mime_type: file.type,
  })
  const presignedRes = await fetch(
    `${__ADMIN_PREFIX__}/api/media/presigned-url?${params.toString()}`,
    { credentials: 'include' }
  )
  const presignedJson = (await presignedRes.json()) as {
    ok: boolean
    data?: { upload_url: string; media_id: string }
    error?: { message: string }
  }
  if (!presignedJson.ok || !presignedJson.data) {
    throw new Error(presignedJson.error?.message ?? 'Failed to get upload URL')
  }

  const { upload_url, media_id } = presignedJson.data

  // Step 2 — PUT directly to storage (no auth headers; presigned URL is self-authenticated).
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', upload_url)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        uploadProgress.value = Math.round((e.loaded / e.total) * 100)
      }
    }

    xhr.onload = () => {
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })

  // Step 3 — confirm with alt text.
  const confirmRes = await fetch(
    `${__ADMIN_PREFIX__}/api/media/confirm/${media_id}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt }),
    }
  )
  const confirmJson = (await confirmRes.json()) as {
    ok: boolean
    data?: MediaItem
    error?: { message: string }
  }
  if (!confirmJson.ok || !confirmJson.data) {
    throw new Error(confirmJson.error?.message ?? 'Upload confirmation failed')
  }

  return confirmJson.data
}

async function startUpload(file: File) {
  uploadPhase.value = 'uploading'
  uploadProgress.value = 0
  uploadError.value = ''

  try {
    const alt = altText.value.trim()
    // Cloud storage uploads straight to the bucket via presigned URL; local
    // storage routes through the server's direct endpoint.
    const item = uiStore.presignedUploads
      ? await uploadPresigned(file, alt)
      : await uploadDirect(file, alt)

    displayItem.value = item
    altText.value = item.alt ?? ''
    emit('update:modelValue', item.id)
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : 'Upload failed'
  } finally {
    uploadPhase.value = 'idle'
    pendingFile.value = null
  }
}

// Persist alt text for images via PATCH after the upload completes.
async function saveAlt() {
  const item = displayItem.value
  if (!item) return

  const xhr = new XMLHttpRequest()
  xhr.withCredentials = true
  xhr.open('PATCH', `${__ADMIN_PREFIX__}/api/media/${item.id}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  xhr.onload = () => {
    try {
      const json = JSON.parse(xhr.responseText) as { ok: boolean; data?: MediaItem }
      if (json.ok && json.data) displayItem.value = json.data
    } catch {
      // Ignore parse errors — display stays as-is.
    }
  }
  xhr.send(JSON.stringify({ alt: altText.value.trim() }))
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  pendingFile.value = file
  altText.value = ''
  ;(e.target as HTMLInputElement).value = '' // allow re-selecting the same file

  if (altRequired.value) {
    uploadPhase.value = 'alt-collect'
  } else {
    void startUpload(file)
  }
}

function startUploadFromForm() {
  if (!pendingFile.value) return
  if (altRequired.value && !altText.value.trim()) return
  void startUpload(pendingFile.value)
}

function cancelUpload() {
  pendingFile.value = null
  altText.value = ''
  uploadPhase.value = 'idle'
  uploadError.value = ''
}

function clearSelection() {
  displayItem.value = null
  altText.value = ''
  emit('update:modelValue', null)
}

function onModalSelect(item: MediaItem) {
  displayItem.value = item
  altText.value = item.alt ?? ''
  showModal.value = false
  emit('update:modelValue', item.id)
}

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(async () => {
  if (typeof props.modelValue !== 'string' || !props.modelValue) return
  const res = await fetch(`${__ADMIN_PREFIX__}/api/media/${props.modelValue}`, {
    credentials: 'include',
  })
  if (!res.ok) return
  const json = (await res.json()) as { ok: boolean; data?: MediaItem }
  if (json.ok && json.data) {
    displayItem.value = json.data
    altText.value = json.data.alt ?? ''
  }
})
</script>

<template>
  <div>
    <label class="block text-[13px] font-semibold text-[#3D3D52]">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <!-- ── Selected media item ─────────────────────────────────────────────── -->
    <div
      v-if="displayItem"
      class="mt-1 flex flex-col gap-2 rounded-md border border-gray-200 p-3"
    >
      <div class="flex items-center gap-3">
        <!-- Image thumbnail -->
        <img
          v-if="displayItem.type === 'image'"
          :src="displayItem.url"
          :alt="displayItem.alt ?? ''"
          class="h-16 w-16 rounded object-cover"
        />
        <!-- Video / file icon placeholder -->
        <div
          v-else
          class="flex h-16 w-16 items-center justify-center rounded bg-gray-100 text-2xl text-gray-400"
          aria-hidden="true"
        >
          {{ displayItem.type === 'video' ? '▶' : '📄' }}
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-800">
            {{ filenameFrom(displayItem.url) }}
          </p>
          <p class="text-xs text-gray-500">{{ formatSize(displayItem.file_size) }}</p>
        </div>

        <button
          v-if="!disabled"
          type="button"
          class="shrink-0 text-lg leading-none text-gray-400 hover:text-red-500"
          aria-label="Remove selected media"
          @click="clearSelection"
        >
          &times;
        </button>
      </div>

      <!-- Optional alt text for images (inline, saved on blur via PATCH) -->
      <div v-if="displayItem.type === 'image' && !disabled">
        <label :for="`${field.name}-alt`" class="block text-xs text-gray-500">
          Alt text <span class="text-gray-400">(optional)</span>
        </label>
        <input
          :id="`${field.name}-alt`"
          v-model="altText"
          type="text"
          placeholder="Describe this image"
          class="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          @blur="saveAlt"
        />
      </div>
    </div>

    <!-- ── Upload in progress ──────────────────────────────────────────────── -->
    <div
      v-else-if="uploadPhase === 'uploading'"
      class="mt-1 rounded-md border border-gray-200 p-3"
    >
      <p class="mb-1.5 text-xs text-gray-500">Uploading…</p>
      <div class="flex items-center gap-2">
        <div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div
            class="h-2 rounded-full bg-indigo-600 transition-all duration-150"
            :style="{ width: `${uploadProgress}%` }"
          />
        </div>
        <span class="w-8 shrink-0 text-right text-xs text-gray-500">
          {{ uploadProgress }}%
        </span>
      </div>
    </div>

    <!-- ── Alt text collection (video / file — required before upload) ────── -->
    <div
      v-else-if="uploadPhase === 'alt-collect'"
      class="mt-1 rounded-md border border-gray-200 p-3"
    >
      <p class="mb-2 truncate text-[13px] font-semibold text-[#3D3D52]">
        {{ pendingFile?.name }}
      </p>
      <label :for="`${field.name}-alt-pre`" class="block text-xs text-gray-600">
        Alt text
        <span class="text-red-500" aria-hidden="true">*</span>
      </label>
      <input
        :id="`${field.name}-alt-pre`"
        v-model="altText"
        type="text"
        placeholder="Describe this file"
        class="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <div class="mt-3 flex justify-end gap-2">
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

    <!-- ── Idle: trigger buttons ───────────────────────────────────────────── -->
    <div v-else class="mt-1 flex gap-2">
      <input
        ref="fileInputRef"
        type="file"
        class="hidden"
        :accept="acceptMime"
        @change="onFileSelected"
      />
      <button
        type="button"
        :disabled="disabled"
        class="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        @click="fileInputRef?.click()"
      >
        Upload
      </button>
      <button
        type="button"
        :disabled="disabled"
        class="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        @click="showModal = true"
      >
        Select from library
      </button>
    </div>

    <!-- Error messages -->
    <p v-if="uploadError" class="mt-1 text-sm text-red-600" role="alert">
      {{ uploadError }}
    </p>
    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>

    <!-- Media select modal -->
    <MediaSelectModal
      v-if="showModal"
      :accepted-type="mediaType"
      @select="onModalSelect"
      @close="showModal = false"
    />
  </div>
</template>
