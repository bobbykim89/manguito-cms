import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useSchemaStore } from './schema'

const STORAGE_KEY = 'manguito_auth'
type StoredAuth = { id: string; email: string; role: string; mustChangePassword: boolean }

function loadStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredAuth) : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const schemaStore = useSchemaStore()

  const stored = loadStored()
  const id = ref<string | null>(stored?.id ?? null)
  const email = ref<string | null>(stored?.email ?? null)
  const role = ref<string | null>(stored?.role ?? null)
  const mustChangePassword = ref(stored?.mustChangePassword ?? false)

  const isAuthenticated = computed(() => id.value !== null)

  // Derived from role name via schema store — not stored directly.
  const permissions = computed<string[]>(() =>
    role.value ? (schemaStore.getRoleByName(role.value)?.permissions ?? []) : []
  )

  // Derived from role name via schema store — not stored directly.
  const hierarchyLevel = computed<number>(() =>
    role.value
      ? (schemaStore.getRoleByName(role.value)?.hierarchy_level ?? Infinity)
      : Infinity
  )

  function setUser(user: {
    id: string
    email: string
    role: string
    mustChangePassword?: boolean
  }) {
    id.value = user.id
    email.value = user.email
    role.value = user.role
    mustChangePassword.value = user.mustChangePassword ?? false
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        id: user.id, email: user.email, role: user.role,
        mustChangePassword: user.mustChangePassword ?? false,
      }))
    } catch { /* storage unavailable (private mode / SSR) — non-fatal */ }
  }

  function clear() {
    id.value = null
    email.value = null
    role.value = null
    mustChangePassword.value = false
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable — non-fatal */ }
  }

  function hasPermission(permission: string): boolean {
    return permissions.value.includes(permission)
  }

  return {
    id,
    email,
    role,
    mustChangePassword,
    isAuthenticated,
    permissions,
    hierarchyLevel,
    setUser,
    clear,
    hasPermission,
  }
})
