<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'

const ui = useUiStore()

// Newest at top — the store appends with push(), so reverse for display.
const visibleToasts = computed(() => [...ui.toasts].reverse())

const variantClasses: Record<string, string> = {
  success: 'bg-green-600 text-white',
  error:   'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  info:    'bg-blue-600 text-white',
}
</script>

<template>
  <div
    aria-live="polite"
    aria-atomic="false"
    class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
  >
    <div
      v-for="toast in visibleToasts"
      :key="toast.id"
      :class="[
        'pointer-events-auto flex w-80 items-start gap-3 rounded-lg px-4 py-3 shadow-lg',
        variantClasses[toast.variant] ?? 'bg-blue-600 text-white',
      ]"
      role="status"
    >
      <span class="flex-1 text-sm">{{ toast.message }}</span>
      <button
        type="button"
        class="shrink-0 opacity-80 hover:opacity-100"
        :aria-label="`Dismiss: ${toast.message}`"
        @click="ui.removeToast(toast.id)"
      >
        &times;
      </button>
    </div>
  </div>
</template>
