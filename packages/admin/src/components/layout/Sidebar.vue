<script setup lang="ts">
import { computed } from 'vue'
import { useSchemaStore } from '../../stores/schema'
import { usePermission } from '../../composables/usePermission'

const schema = useSchemaStore()
const { can } = usePermission()

const contentTypeList = computed(() => Object.values(schema.contentTypes))
const taxonomyTypeList = computed(() => Object.values(schema.taxonomyTypes))

// Expose the Vite define constant to the template scope.
const adminPrefix = __ADMIN_PREFIX__
</script>

<template>
  <nav
    class="flex h-full w-56 shrink-0 flex-col gap-0.5 overflow-y-auto bg-gray-900 px-3 py-4"
    aria-label="Main navigation"
  >
    <!-- Content types — always visible, generated from schema -->
    <p class="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
      Content
    </p>
    <RouterLink
      v-for="type in contentTypeList"
      :key="type.name"
      :to="`${adminPrefix}/content/${type.name}`"
      class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
      active-class="bg-gray-700 text-white"
    >
      {{ type.label }}
    </RouterLink>

    <!-- Taxonomy types — always visible, generated from schema -->
    <template v-if="taxonomyTypeList.length > 0">
      <p class="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Taxonomy
      </p>
      <RouterLink
        v-for="type in taxonomyTypeList"
        :key="type.name"
        :to="`${adminPrefix}/taxonomy/${type.name}`"
        class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
        active-class="bg-gray-700 text-white"
      >
        {{ type.label }}
      </RouterLink>
    </template>

    <hr class="my-3 border-gray-700" />

    <!-- Media — gated: v-if, never v-show or disabled -->
    <RouterLink
      v-if="can('media:read')"
      :to="`${adminPrefix}/media`"
      class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
      active-class="bg-gray-700 text-white"
    >
      Media
    </RouterLink>

    <!-- Users — gated: users:read -->
    <RouterLink
      v-if="can('users:read')"
      :to="`${adminPrefix}/users`"
      class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
      active-class="bg-gray-700 text-white"
    >
      Users
    </RouterLink>

    <!-- Roles — gated: roles:read -->
    <RouterLink
      v-if="can('roles:read')"
      :to="`${adminPrefix}/roles`"
      class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
      active-class="bg-gray-700 text-white"
    >
      Roles
    </RouterLink>
  </nav>
</template>
