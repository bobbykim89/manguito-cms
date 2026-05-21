<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { ParsedRole } from '@bobbykim/manguito-cms-core'
import { useAuthStore } from './stores/auth'
import { useSchemaStore } from './stores/schema'
import { useUiStore } from './stores/ui'

// ─── Config response shape ────────────────────────────────────────────────────
// Matches the spec in phase-08-api-client.md.
// The current API config endpoint returns cms_name, version, and roles.
// user and media are included here for when the API is extended.

type ConfigResponse = {
  cms_name: string
  version: string
  roles: Array<{
    name: string
    label: string
    hierarchy_level: number
    is_system?: boolean
    permissions?: string[]
  }>
  user?: {
    id: string
    email: string
    role: string
    must_change_password: boolean
  }
  media?: {
    max_file_size: number
  }
}

// ─── Component state ──────────────────────────────────────────────────────────

const loading = ref(true)
const router = useRouter()
const authStore = useAuthStore()
const schemaStore = useSchemaStore()
const uiStore = useUiStore()

// ─── Bootstrap ────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const response = await fetch(`${__ADMIN_PREFIX__}/api/config`, {
      credentials: 'include',
    })

    if (response.status === 401) {
      authStore.clear()
      router.push(`${__ADMIN_PREFIX__}/login`)
      return
    }

    if (response.ok) {
      const result = await response.json() as { ok: true; data: ConfigResponse }
      const data = result.data

      // Populate schema store — roles come from config.
      // Map to full ParsedRole shape, defaulting fields the API may omit.
      schemaStore.setRoles(
        data.roles.map(r => ({
          name: r.name,
          label: r.label,
          hierarchy_level: r.hierarchy_level,
          is_system: r.is_system ?? false,
          permissions: (r.permissions ?? []) as ParsedRole['permissions'],
        }))
      )

      // Populate auth store from user identity when present in response.
      if (data.user) {
        authStore.setUser({
          id: data.user.id,
          email: data.user.email,
          role: data.user.role,
          mustChangePassword: data.user.must_change_password,
        })
      }

      // Populate ui store with media config when present.
      if (data.media) {
        uiStore.setMaxFileSize(data.media.max_file_size)
      }

      // Navigate based on must_change_password state.
      if (authStore.mustChangePassword) {
        router.push(`${__ADMIN_PREFIX__}/change-password`)
      }
      // Otherwise let the router proceed to the intended route.
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div
    v-if="loading"
    class="fixed inset-0 flex items-center justify-center bg-white"
    aria-label="Loading"
  >
    <div
      class="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600"
      role="status"
    />
  </div>

  <router-view v-else />
</template>
