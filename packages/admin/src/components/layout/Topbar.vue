<script setup lang="ts">
import { useUiStore } from '../../stores/ui'

const uiStore = useUiStore()
</script>

<template>
  <header
    class="flex h-[60px] shrink-0 items-center gap-[13px] border-b border-card-border bg-white/85 px-4 backdrop-blur-md"
  >
    <button
      type="button"
      class="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-[#4A4A60] transition-colors hover:bg-[#F1F0F7]"
      aria-label="Toggle sidebar"
      @click="uiStore.toggleSidebar()"
    >
      <!-- Hamburger on mobile (opens drawer), panel-collapse icon on desktop -->
      <svg
        v-if="uiStore.isMobile"
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
      >
        <path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" />
      </svg>
      <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M9 3v18" />
      </svg>
    </button>

    <div class="flex min-w-0 items-center gap-[9px]">
      <span class="shrink-0 rounded-[7px] bg-indigo-50 px-[9px] py-[3px] text-[10.5px] font-bold tracking-[.05em] text-indigo-600">
        ADMIN
      </span>
      <span class="overflow-hidden truncate whitespace-nowrap text-[14.5px] font-semibold text-[#2C2C44]">
        {{ uiStore.cmsName }}
      </span>
    </div>

    <div class="flex-1" />
  </header>
</template>
