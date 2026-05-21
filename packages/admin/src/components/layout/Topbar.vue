<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useUiStore } from '../../stores/ui'
import { useApiClient } from '../../composables/useApiClient'

const router = useRouter()
const authStore = useAuthStore()
const uiStore = useUiStore()
const api = useApiClient()

async function logout() {
  // Always clear client session and redirect — regardless of server response.
  await api.post('/auth/logout', {})
  authStore.clear()
  router.push(`${__ADMIN_PREFIX__}/login`)
}

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

    <button
      type="button"
      class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800"
      @click="logout"
    >
      Log out
    </button>
  </header>
</template>
