<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSchemaStore } from '../../stores/schema'
import { useAuthStore } from '../../stores/auth'
import { usePermission } from '../../composables/usePermission'
import { useApiClient } from '../../composables/useApiClient'

const schema = useSchemaStore()
const authStore = useAuthStore()
const { can } = usePermission()
const router = useRouter()
const api = useApiClient()

const contentTypeList = computed(() => Object.values(schema.contentTypes))
const taxonomyTypeList = computed(() => Object.values(schema.taxonomyTypes))

const roleLabel = computed(() => {
  if (!authStore.role) return null
  return schema.getRoleByName(authStore.role)?.label ?? authStore.role
})

const contentOpen = ref(true)
const taxonomyOpen = ref(true)

const adminPrefix = __ADMIN_PREFIX__

async function logout() {
  await api.post('/auth/logout', {})
  authStore.clear()
  router.push(`${adminPrefix}/login`)
}
</script>

<template>
  <nav
    class="flex h-full w-56 shrink-0 flex-col overflow-y-auto bg-gray-900 px-3 py-4"
    aria-label="Main navigation"
  >
    <!-- Scrollable top section -->
    <div class="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      <!-- Content types — collapsible -->
      <button
        type="button"
        class="mb-1 flex w-full items-center justify-between px-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-400"
        @click="contentOpen = !contentOpen"
        :aria-expanded="contentOpen"
      >
        <span>Content</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3 w-3 transition-transform"
          :class="contentOpen ? 'rotate-180' : ''"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.5"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <template v-if="contentOpen">
        <RouterLink
          v-for="type in contentTypeList"
          :key="type.name"
          :to="`${adminPrefix}/content/${type.name}`"
          class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
          active-class="bg-gray-700 text-white"
        >
          {{ type.label }}
        </RouterLink>
      </template>

      <!-- Taxonomy types — collapsible -->
      <template v-if="taxonomyTypeList.length > 0">
        <button
          type="button"
          class="mb-1 mt-4 flex w-full items-center justify-between px-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-400"
          @click="taxonomyOpen = !taxonomyOpen"
          :aria-expanded="taxonomyOpen"
        >
          <span>Taxonomy</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-3 w-3 transition-transform"
            :class="taxonomyOpen ? 'rotate-180' : ''"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2.5"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <template v-if="taxonomyOpen">
          <RouterLink
            v-for="type in taxonomyTypeList"
            :key="type.name"
            :to="`${adminPrefix}/taxonomy/${type.name}`"
            class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
            active-class="bg-gray-700 text-white"
          >
            {{ type.label }}
          </RouterLink>
        </template>
      </template>

      <hr class="my-3 border-gray-700" />

      <!-- Media — gated -->
      <RouterLink
        v-if="can('media:read')"
        :to="`${adminPrefix}/media`"
        class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
        active-class="bg-gray-700 text-white"
      >
        Media
      </RouterLink>

      <!-- Users — gated -->
      <RouterLink
        v-if="can('users:read')"
        :to="`${adminPrefix}/users`"
        class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
        active-class="bg-gray-700 text-white"
      >
        Users
      </RouterLink>

      <!-- Roles — gated -->
      <RouterLink
        v-if="can('roles:read')"
        :to="`${adminPrefix}/roles`"
        class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
        active-class="bg-gray-700 text-white"
      >
        Roles
      </RouterLink>
    </div>

    <!-- Bottom: user info + logout -->
    <div class="mt-3 border-t border-gray-700 pt-3">
      <div v-if="authStore.email" class="mb-2 px-2">
        <p class="truncate text-xs font-medium text-gray-300">{{ authStore.email }}</p>
        <p v-if="roleLabel" class="mt-0.5 text-xs text-gray-500">{{ roleLabel }}</p>
      </div>
      <button
        type="button"
        class="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-400 hover:bg-gray-700 hover:text-white"
        @click="logout"
      >
        Log out
      </button>
    </div>
  </nav>
</template>
