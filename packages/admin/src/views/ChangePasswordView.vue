<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApiClient } from '../composables/useApiClient'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const api = useApiClient()
const authStore = useAuthStore()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const formError = ref('')

async function onSubmit() {
  formError.value = ''

  if (newPassword.value !== confirmPassword.value) {
    formError.value = 'Passwords do not match.'
    return
  }

  submitting.value = true

  const res = await api.post<{
    id: string
    email: string
    role: string
    must_change_password: boolean
  }>('/users/change-password', {
    current_password: currentPassword.value,
    new_password: newPassword.value,
  })

  submitting.value = false

  if (!res.ok) {
    if (res.error.code === 'INVALID_CREDENTIALS') {
      formError.value = 'Current password is incorrect.'
    } else {
      formError.value = 'Something went wrong. Please try again.'
    }
    return
  }

  // Only mustChangePassword changes — id/email/role are unchanged.
  authStore.setUser({
    id: authStore.id!,
    email: authStore.email!,
    role: authStore.role!,
    mustChangePassword: false,
  })

  void router.push(`${__ADMIN_PREFIX__}/media`)
}
</script>

<template>
  <!-- Standalone layout — no AppShell/sidebar chrome -->
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm">
      <h1 class="mb-2 text-center text-2xl font-bold text-gray-900">Change password</h1>
      <p class="mb-8 text-center text-sm text-gray-500">
        You must set a new password before continuing.
      </p>

      <form class="space-y-5" novalidate @submit.prevent="onSubmit">
        <!-- Current password -->
        <div>
          <label for="current-password" class="block text-sm font-medium text-gray-700">
            Current password
          </label>
          <input
            id="current-password"
            v-model="currentPassword"
            type="password"
            required
            autocomplete="current-password"
            :disabled="submitting"
            class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <!-- New password -->
        <div>
          <label for="new-password" class="block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id="new-password"
            v-model="newPassword"
            type="password"
            required
            autocomplete="new-password"
            :disabled="submitting"
            class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <!-- Confirm new password -->
        <div>
          <label for="confirm-password" class="block text-sm font-medium text-gray-700">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            required
            autocomplete="new-password"
            :disabled="submitting"
            class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <!-- Inline error -->
        <p v-if="formError" class="text-sm text-red-600" role="alert">
          {{ formError }}
        </p>

        <!-- Submit -->
        <button
          type="submit"
          :disabled="submitting"
          class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ submitting ? 'Saving…' : 'Set new password' }}
        </button>
      </form>
    </div>
  </div>
</template>
