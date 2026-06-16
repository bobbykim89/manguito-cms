<script setup lang="ts">
import { useUiStore } from '../../stores/ui'

const uiStore = useUiStore()

function toggleSidebar() {
  uiStore.sidebarOpen = !uiStore.sidebarOpen
}
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-4 border-b border-gray-200 bg-white px-4">
    <button
      type="button"
      class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      aria-label="Toggle sidebar"
      @click="toggleSidebar"
    >
      <!-- Hamburger icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    <span class="flex-1 text-sm font-semibold text-gray-800">
      {{ uiStore.cmsName }}
    </span>
  </header>
</template>
