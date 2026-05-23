import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useSchemaStore } from './schema'

export const useAuthStore = defineStore('auth', () => {
  const schemaStore = useSchemaStore()

  const id = ref<string | null>(null)
  const email = ref<string | null>(null)
  const role = ref<string | null>(null)
  const mustChangePassword = ref(false)

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
  }

  function clear() {
    id.value = null
    email.value = null
    role.value = null
    mustChangePassword.value = false
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
