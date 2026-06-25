<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useUsersStore } from '../../stores/users'
import type { UserResponse } from '../../stores/users'

const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const usersStore = useUsersStore()

const search = ref('')

// Full list is already loaded eagerly (no pagination on this endpoint) — filter client-side.
const filteredUsers = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (term === '') return usersStore.users
  return usersStore.users.filter(u => u.email.toLowerCase().includes(term))
})

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

    <!-- Search -->
    <div
      v-else-if="usersStore.users.length > 0"
      class="mb-4 flex h-9.5 items-center gap-2 rounded-[10px] border border-card-border bg-[#FBFBFD] px-2.75 text-[13px] transition-colors focus-within:border-indigo-400"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-faint">
        <path d="M21 21l-4.3-4.3" /><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      </svg>
      <input
        v-model="search"
        type="text"
        placeholder="Search users…"
        class="w-full bg-transparent text-ink outline-none placeholder:text-faint"
      />
    </div>

    <!-- Empty -->
    <div
      v-if="!usersStore.loading && usersStore.users.length === 0"
      class="rounded-2xl border border-dashed border-gray-300 p-12 text-center text-sm text-muted"
    >
      No users found.
    </div>

    <!-- No search results -->
    <div
      v-else-if="!usersStore.loading && filteredUsers.length === 0"
      class="rounded-2xl border border-dashed border-gray-300 p-12 text-center text-sm text-muted"
    >
      No results for “{{ search.trim() }}”.
    </div>

    <!-- Table -->
    <div v-else-if="!usersStore.loading" class="overflow-hidden rounded-2xl border border-card-border bg-white shadow-[0_1px_2px_rgba(24,24,48,0.04),0_10px_28px_rgba(24,24,48,0.04)]">
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
            v-for="user in filteredUsers"
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
