<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useNotification } from '../../composables/useNotification'
import { useAuthStore } from '../../stores/auth'
import { useUsersStore } from '../../stores/users'
import type { UserResponse } from '../../stores/users'
import ConfirmDialog from '../../components/shared/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { can, rolesBelow } = usePermission()
const notify = useNotification()
const authStore = useAuthStore()
const usersStore = useUsersStore()

// ── Mode ──────────────────────────────────────────────────────────────────────

const routeId = computed(() => route.params.id as string | undefined)
const isEdit = computed(() => !!routeId.value)
const isOwnProfile = computed(() => authStore.id === routeId.value)

// ── Form state ────────────────────────────────────────────────────────────────

const email = ref('')
const selectedRole = ref('')
const loading = ref(false)
const saving = ref(false)
const formError = ref('')

// Shown once after successful user creation.
const temporaryPassword = ref<string | null>(null)
const copied = ref(false)

// Password reset result.
const resetPassword = ref<string | null>(null)
const resetting = ref(false)

const showDeleteConfirm = ref(false)

// ── Load user (edit mode) ─────────────────────────────────────────────────────

onMounted(async () => {
  if (!isEdit.value || !routeId.value) {
    // Create mode: default role to first available below current user.
    selectedRole.value = rolesBelow()[0]?.name ?? ''
    return
  }

  loading.value = true
  const cached = usersStore.users.find(u => u.id === routeId.value)
  if (cached) {
    email.value = cached.email
    selectedRole.value = cached.role
    loading.value = false
    return
  }

  const res = await api.get<UserResponse>(`/users/${routeId.value}`)
  loading.value = false
  if (res.ok) {
    email.value = res.data.email
    selectedRole.value = res.data.role
    usersStore.setUser(res.data)
  }
})

// ── Submit ────────────────────────────────────────────────────────────────────

async function onSubmit() {
  formError.value = ''
  saving.value = true

  if (isEdit.value) {
    // Edit: patch email and role (role hidden for own profile so selectedRole stays unchanged).
    const res = await api.patch<UserResponse>(`/users/${routeId.value!}`, {
      email: email.value.trim(),
      role: selectedRole.value,
    })
    saving.value = false
    if (!res.ok) {
      formError.value = res.error.message
      return
    }
    usersStore.setUser(res.data)
    notify.success('User updated.')
  } else {
    // Create: POST and show temp password.
    const res = await api.post<UserResponse & { temporary_password?: string }>('/users', {
      email: email.value.trim(),
      role: selectedRole.value,
    })
    saving.value = false
    if (!res.ok) {
      formError.value = res.error.message
      return
    }
    usersStore.setUser(res.data)
    temporaryPassword.value = res.data.temporary_password ?? null
    notify.success('User created.')
  }
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

async function copyPassword(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Fallback: select the input text.
  }
}

// ── Reset password ────────────────────────────────────────────────────────────

async function doResetPassword() {
  if (!routeId.value) return
  resetting.value = true
  const res = await api.post<{ temporary_password: string }>(`/users/${routeId.value}/reset-password`, {})
  resetting.value = false
  if (res.ok) {
    resetPassword.value = res.data.temporary_password
    copied.value = false
  } else {
    notify.error(res.error.message)
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function doDelete() {
  showDeleteConfirm.value = false
  if (!routeId.value) return
  saving.value = true
  const res = await api.del(`/users/${routeId.value}`)
  saving.value = false
  if (!res.ok) {
    formError.value = (res as { ok: false; error: { message: string } }).error.message
    return
  }
  usersStore.removeUser(routeId.value)
  void router.push({ name: 'user-list' })
}

// ── Page title ────────────────────────────────────────────────────────────────

const pageTitle = computed(() => isEdit.value ? (email.value || 'Edit user') : 'New user')
</script>

<template>
  <!-- Loading -->
  <div v-if="loading" class="flex items-center justify-center py-20">
    <span
      class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
      aria-hidden="true"
    />
  </div>

  <div v-else class="mx-auto max-w-lg">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between gap-4">
      <h1 class="text-[26px] font-bold tracking-tight text-ink">{{ pageTitle }}</h1>

      <div class="flex shrink-0 items-center gap-2">
        <!-- Reset password -->
        <button
          v-if="can('users:edit') && isEdit && !isOwnProfile"
          type="button"
          :disabled="resetting"
          class="rounded-md px-3 py-2 text-[13px] font-semibold text-[#3D3D52] ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="doResetPassword"
        >
          {{ resetting ? 'Resetting…' : 'Reset password' }}
        </button>

        <!-- Delete -->
        <button
          v-if="can('users:delete') && isEdit && !isOwnProfile"
          type="button"
          :disabled="saving"
          class="rounded-md px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="showDeleteConfirm = true"
        >
          Delete
        </button>
      </div>
    </div>

    <!-- Temporary password box (shown once after creation) -->
    <div
      v-if="temporaryPassword"
      class="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4"
      role="alert"
    >
      <p class="mb-2 text-sm font-medium text-amber-800">
        User created. Share this temporary password — it will not be shown again.
      </p>
      <div class="flex items-center gap-2">
        <input
          :value="temporaryPassword"
          type="text"
          readonly
          class="flex-1 rounded-md border border-amber-200 bg-white px-3 py-1.5 font-mono text-sm"
        />
        <button
          type="button"
          class="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          @click="copyPassword(temporaryPassword)"
        >
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>
    </div>

    <!-- Reset password box (shown after password reset) -->
    <div
      v-if="resetPassword"
      class="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4"
      role="alert"
    >
      <p class="mb-2 text-sm font-medium text-amber-800">
        Password reset. Share this temporary password — it will not be shown again.
      </p>
      <div class="flex items-center gap-2">
        <input
          :value="resetPassword"
          type="text"
          readonly
          class="flex-1 rounded-md border border-amber-200 bg-white px-3 py-1.5 font-mono text-sm"
        />
        <button
          type="button"
          class="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          @click="copyPassword(resetPassword)"
        >
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>
    </div>

    <!-- Form -->
    <form class="space-y-5" novalidate @submit.prevent="onSubmit">
      <!-- Email -->
      <div>
        <label for="user-email" class="block text-[13px] font-semibold text-[#3D3D52]">Email</label>
        <input
          id="user-email"
          v-model="email"
          type="email"
          required
          autocomplete="email"
          :disabled="saving"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <!-- Role picker — hidden for own profile to prevent self-demotion -->
      <div v-if="!isOwnProfile">
        <label for="user-role" class="block text-[13px] font-semibold text-[#3D3D52]">Role</label>
        <select
          id="user-role"
          v-model="selectedRole"
          :disabled="saving || rolesBelow().length === 0"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="" disabled>Select a role</option>
          <option
            v-for="r in rolesBelow()"
            :key="r.name"
            :value="r.name"
          >
            {{ r.label }}
          </option>
        </select>
        <p v-if="rolesBelow().length === 0" class="mt-1 text-xs text-gray-400">
          No assignable roles available.
        </p>
      </div>

      <!-- Form error -->
      <p v-if="formError" class="text-sm text-red-600" role="alert">{{ formError }}</p>

      <!-- Submit -->
      <button
        v-if="isEdit ? can('users:edit') : can('users:create')"
        type="submit"
        :disabled="saving || !email.trim() || (!isOwnProfile && !selectedRole)"
        class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user' }}
      </button>
    </form>

    <!-- Delete confirmation -->
    <ConfirmDialog
      v-if="showDeleteConfirm"
      message="Are you sure you want to delete this user? This action cannot be undone."
      :on-confirm="doDelete"
      :on-cancel="() => (showDeleteConfirm = false)"
    />
  </div>
</template>
