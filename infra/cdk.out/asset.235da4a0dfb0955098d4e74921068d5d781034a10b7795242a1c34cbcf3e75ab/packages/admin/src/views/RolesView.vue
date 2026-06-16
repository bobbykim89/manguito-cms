<script setup lang="ts">
import { computed } from 'vue'
import { useSchemaStore } from '../stores/schema'

const schemaStore = useSchemaStore()

const roles = computed(() =>
  [...schemaStore.roles].sort((a, b) => a.hierarchy_level - b.hierarchy_level)
)
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-gray-900">Roles</h1>
      <p class="mt-1 text-sm text-gray-500">
        Roles are schema-defined and read-only. Use the CLI to modify them.
      </p>
    </div>

    <div
      v-if="roles.length === 0"
      class="rounded-lg border border-dashed border-gray-300 p-12 text-center text-sm text-gray-500"
    >
      No roles configured.
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="role in roles"
        :key="role.name"
        class="rounded-lg border border-gray-200 bg-white p-5"
      >
        <!-- Role header -->
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="font-medium text-gray-900">{{ role.label }}</h2>
            <p class="text-xs font-mono text-gray-400">{{ role.name }}</p>
          </div>
          <span class="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            Level {{ role.hierarchy_level }}
          </span>
        </div>

        <!-- Permissions -->
        <div class="mt-3">
          <p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
            Permissions
          </p>
          <div
            v-if="role.permissions.length === 0"
            class="text-xs text-gray-400"
          >
            No permissions assigned.
          </div>
          <div v-else class="flex flex-wrap gap-1.5">
            <span
              v-for="perm in role.permissions"
              :key="perm"
              class="rounded-full bg-indigo-50 px-2.5 py-0.5 font-mono text-xs font-medium text-indigo-700"
            >
              {{ perm }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
