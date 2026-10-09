<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { MediaItem } from '@bobbykim/manguito-cms-core'
import { fileKind, type FileTone } from '../../utils/file-kind'

// The thumbnail every media view shows: the image itself, a video's first
// frame, or a typed document badge. Fills its parent; the parent sets the size.
const props = defineProps<{
  item: Pick<MediaItem, 'type' | 'url' | 'mime_type' | 'alt'>
  // Optional caption lines under a file badge (e.g. file name, then size).
  label?: string | undefined
  detail?: string | undefined
}>()

const root = ref<HTMLElement | null>(null)

// A video loads only once it scrolls into view, so a grid of videos does not
// fetch every file's metadata at once. Without IntersectionObserver (older
// browsers, jsdom) it loads immediately.
const inView = ref(typeof IntersectionObserver === 'undefined')
const videoFailed = ref(false)
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (props.item.type !== 'video' || inView.value || !root.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      inView.value = true
      observer?.disconnect()
      observer = null
    }
  })
  observer.observe(root.value)
})

onBeforeUnmount(() => observer?.disconnect())

// `#t=0.1` asks the browser for the frame just after the start: some codecs
// paint black at exactly 0. preload="metadata" fetches only what that needs.
const frameSrc = computed(() => (inView.value ? `${props.item.url}#t=0.1` : undefined))

const kind = computed(() => fileKind(props.item.mime_type, props.item.url))

const TONE: Record<FileTone, string> = {
  red: 'bg-red-600',
  blue: 'bg-blue-600',
  green: 'bg-green-600',
  orange: 'bg-orange-500',
  gray: 'bg-gray-500',
}
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
        class="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white"
        aria-hidden="true"
      >▶</span>
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
        :class="['rounded px-1 text-[10px] font-semibold leading-4 text-white', item.type === 'video' ? 'bg-gray-700' : TONE[kind.tone]]"
      >{{ item.type === 'video' ? 'VIDEO' : kind.label }}</span>
      <span v-if="label" class="max-w-full truncate text-center text-xs">{{ label }}</span>
      <span v-if="detail" class="text-xs text-gray-300">{{ detail }}</span>
    </div>
  </div>
</template>
