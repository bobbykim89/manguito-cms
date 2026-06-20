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
    <div class="mb-5.5 flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-[26px] font-bold tracking-tight text-ink">Users</h1>
      <button
        v-if="can('users:create')"
        type="button"
        class="inline-flex items-center gap-1.75 rounded-[11px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_3px_10px_rgba(91,87,232,0.3)] transition-all hover:bg-indigo-700 hover:shadow-[0_6px_18px_rgba(91,87,232,0.4)]"
        @click="goToCreate"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        New user
      </button>
    </div>

    <!-- Loading -->
    <div v-if="usersStore.loading" class="space-y-2">
      <div v-for="n in 5" :key="n" class="h-12 animate-pulse rounded-[10px] bg-gray-100" />
    </div>

    <!-- Empty -->
    <div
      v-else-if="usersStore.users.length === 0"
      class="rounded-2xl border border-dashed border-gray-300 p-12 text-center text-sm text-muted"
    >
      No users found.
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden rounded-2xl border border-card-border bg-white shadow-[0_1px_2px_rgba(24,24,48,0.04),0_10px_28px_rgba(24,24,48,0.04)]">
      <table class="w-full text-sm">
        <thead class="text-[11.5px] font-bold uppercase tracking-[.06em] text-faint">
          <tr class="border-b border-divider">
            <th class="px-5.5 py-3.5 text-left">Email</th>
            <th class="px-5.5 py-3.5 text-left">Role</th>
            <th class="px-5.5 py-3.5 text-left">Created</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#F4F3F9]">
          <tr
            v-for="user in usersStore.users"
            :key="user.id"
            class="cursor-pointer transition-colors hover:bg-[#FAFAFE]"
            @click="goToEdit(user)"
          >
            <td class="px-5.5 py-4 text-[14.5px] font-semibold text-ink">{{ user.email }}</td>
            <td class="px-5.5 py-4">
              <span class="rounded-[7px] bg-indigo-50 px-2.5 py-1 font-mono text-xs font-medium text-indigo-600">{{ user.role }}</span>
            </td>
            <td class="px-5.5 py-4 text-[13px] text-faint">{{ formatDate(user.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
