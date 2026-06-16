<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useUsersStore } from '../../stores/users'
import type { UserResponse } from '../../stores/users'

const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const usersStore = useUsersStore()

function formatDate(val: string | unknown): string {
  if (typeof val !== 'string' || !val) return '—'
  return new Date(val).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

onMounted(async () => {
  if (usersStore.users.length > 0) return // already loaded
  usersStore.loading = true
  const res = await api.get<UserResponse[]>('/users')
  usersStore.loading = false
  if (res.ok) usersStore.setUsers(res.data)
})

function goToEdit(user: UserResponse) {
  void router.push({ name: 'user-edit', params: { id: user.id } })
}

function goToCreate() {
  void router.push({ name: 'user-new' })
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Users</h1>
      <button
        v-if="can('users:create')"
        type="button"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        @click="goToCreate"
      >
        New user
      </button>
    </div>

    <!-- Loading -->
    <div v-if="usersStore.loading" class="space-y-2">
      <div v-for="n in 5" :key="n" class="h-12 animate-pulse rounded-md bg-gray-100" />
    </div>

    <!-- Empty -->
    <div
      v-else-if="usersStore.users.length === 0"
      class="rounded-lg border border-dashed border-gray-300 p-12 text-center text-sm text-gray-500"
    >
      No users found.
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden rounded-lg border border-gray-200">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-3 text-left">Email</th>
            <th class="px-4 py-3 text-left">Role</th>
            <th class="px-4 py-3 text-left">Created</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="user in usersStore.users"
            :key="user.id"
            class="cursor-pointer hover:bg-gray-50"
            @click="goToEdit(user)"
          >
            <td class="px-4 py-3 font-medium text-gray-900">{{ user.email }}</td>
            <td class="px-4 py-3 text-gray-600">{{ user.role }}</td>
            <td class="px-4 py-3 text-gray-500">{{ formatDate(user.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
