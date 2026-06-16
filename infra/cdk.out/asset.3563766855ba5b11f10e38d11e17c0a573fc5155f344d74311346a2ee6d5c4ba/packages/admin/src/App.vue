<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ParsedRole } from '@bobbykim/manguito-cms-core'
import { useAuthStore } from './stores/auth'
import { useSchemaStore, type ApiSchemaResponse } from './stores/schema'
import { useUiStore } from './stores/ui'

// ─── Config response shape ────────────────────────────────────────────────────
// Matches the spec in phase-08-api-client.md.
// The current API config endpoint returns cms_name, version, and roles.
// user and media are included here for when the API is extended.

type ConfigResponse = {
  cms_name: string
  version: string
  roles: Array<{ name: string; label: string; hierarchy_level: number }>
  all_roles?: Array<{
    name: string
    label: string
    hierarchy_level: number
    is_system: boolean
    permissions: string[]
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

async function fetchConfigAndSchema(redirectOn401 = true): Promise<void> {
  const response = await fetch(`${__ADMIN_PREFIX__}/api/config`, {
    credentials: 'include',
  })

  if (response.status === 401) {
    if (redirectOn401) {
      authStore.clear()
      void router.push(`${__ADMIN_PREFIX__}/login`)
    }
    return
  }

  if (response.ok) {
    const result = await response.json() as { ok: true; data: ConfigResponse }
    const data = result.data

    const roleSource = data.all_roles ?? []
    schemaStore.setRoles(
      roleSource.map(r => ({
        name: r.name,
        label: r.label,
        hierarchy_level: r.hierarchy_level,
        is_system: r.is_system,
        permissions: r.permissions as ParsedRole['permissions'],
      }))
    )

    if (data.user) {
      authStore.setUser({
        id: data.user.id,
        email: data.user.email,
        role: data.user.role,
        mustChangePassword: data.user.must_change_password,
      })
    }

    uiStore.setCmsName(data.cms_name)

    if (data.media?.max_file_size) {
      uiStore.setMaxFileSize(data.media.max_file_size)
    }

    const schemaRes = await fetch(`${__ADMIN_PREFIX__}/api/schema`, { credentials: 'include' })
    if (schemaRes.ok) {
      const schemaResult = await schemaRes.json() as { ok: true; data: ApiSchemaResponse }
      schemaStore.setFromApiSchema(schemaResult.data)
    }

    if (authStore.mustChangePassword) {
      void router.push(`${__ADMIN_PREFIX__}/change-password`)
    }
  }
}

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    loading.value = false
    return
  }
  try {
    await fetchConfigAndSchema()
  } finally {
    loading.value = false
  }
})

watch(() => uiStore.cmsName, (name) => { document.title = name }, { immediate: true })

// Re-run bootstrap when the user logs in (isAuthenticated flips false → true).
// Show the loading spinner during the fetch so AppShell never renders with an
// empty schema store (same guarantee as a page refresh gives).
watch(() => authStore.isAuthenticated, async (isAuth, wasAuth) => {
  if (isAuth && !wasAuth) {
    loading.value = true
    try {
      await fetchConfigAndSchema(false)
    } catch {
      // ignore
    } finally {
      loading.value = false
    }
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
