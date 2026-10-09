<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { MediaItem } from '@bobbykim/manguito-cms-core'
import { fileKind, TONE_CLASS } from '../../utils/file-kind'

// The thumbnail every media view shows: the image itself, a video's first
// frame, or a typed document badge. Fills its parent; the parent sets the size.
const props = defineProps<{
  item: Pick<MediaItem, 'type' | 'url' | 'mime_type' | 'alt'>
  // Optional caption lines: under a file badge, or over a video frame.
  label?: string | undefined
  detail?: string | undefined
}>()

const root = ref<HTMLElement | null>(null)

// A video loads only once it scrolls into view, so a grid of videos does not
// fetch every file's metadata at once. Without IntersectionObserver (older
// browsers, jsdom) it loads immediately.
const canObserve = typeof IntersectionObserver !== 'undefined'
const inView = ref(!canObserve)
const videoFailed = ref(false)
let observer: IntersectionObserver | null = null

function stopObserving() {
  observer?.disconnect()
  observer = null
}

// Starts fresh for the current item. The media field preview keeps this
// component mounted while its selection changes, so this runs on mount AND on
// every item change: a failure or a pending observer belongs to the old item.
function track() {
  stopObserving()
  videoFailed.value = false
  inView.value = !canObserve
  if (props.item.type !== 'video' || !canObserve || !root.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      inView.value = true
      stopObserving()
    }
  })
  observer.observe(root.value)
}

onMounted(track)
watch(() => [props.item.url, props.item.type], track)
onBeforeUnmount(stopObserving)

// `#t=0.1` asks the browser for the frame just after the start: some codecs
// paint black at exactly 0. preload="metadata" fetches only what that needs.
const frameSrc = computed(() => (inView.value ? `${props.item.url}#t=0.1` : undefined))

const kind = computed(() => fileKind(props.item.mime_type, props.item.url))
</script>

<template>
  <div ref="root" class="relative h-full w-full overflow-hidden">
    <img
      v-if="item.type === 'image'"
      :src="item.url"
      :alt="item.alt ?? ''"
      class="h-full w-full object-cover"
      loading="lazy"
    />

    <template v-else-if="item.type === 'video' && !videoFailed">
      <video
        :src="frameSrc"
        preload="metadata"
        muted
        playsinline
        class="h-full w-full bg-gray-900 object-cover"
        @error="videoFailed = true"
      />
      <span
        class="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white"
        aria-hidden="true"
      >▶</span>
      <div
        v-if="label || detail"
        class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 text-center"
      >
        <p v-if="label" class="truncate text-xs text-white">{{ label }}</p>
        <p v-if="detail" class="text-[10px] text-gray-200">{{ detail }}</p>
      </div>
    </template>

    <div
      v-else
      class="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-50 p-1 text-gray-400"
    >
      <span class="relative inline-flex" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="h-9 w-9" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      </span>
      <span
        data-testid="file-badge"
        :class="['rounded px-1 text-[10px] font-semibold leading-4 text-white', item.type === 'video' ? 'bg-gray-700' : TONE_CLASS[kind.tone]]"
      >{{ item.type === 'video' ? 'VIDEO' : kind.label }}</span>
      <span v-if="label" class="max-w-full truncate text-center text-xs">{{ label }}</span>
      <span v-if="detail" class="text-xs text-gray-300">{{ detail }}</span>
    </div>
  </div>
</template>
