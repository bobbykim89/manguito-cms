<script setup lang="ts">
import { computed } from 'vue'
import { useSchemaStore } from '../stores/schema'

const schemaStore = useSchemaStore()

const roles = computed(() =>
  [...schemaStore.roles].sort((a, b) => a.hierarchy_level - b.hierarchy_level)
)

// Permission tokens look like "content:read" — color by the category prefix, matching the design.
const PERM_PALETTE: Record<string, { bg: string; color: string }> = {
  content: { bg: '#EEEDFB', color: '#5B57E8' },
  media: { bg: '#E3F4FB', color: '#0E86AB' },
  taxonomy: { bg: '#FBF1E2', color: '#B5780F' },
  users: { bg: '#F2EAFB', color: '#8B3FD6' },
  roles: { bg: '#EDEFF3', color: '#5A6478' },
}

function permStyle(token: string): string {
  const palette = PERM_PALETTE[token.split(':')[0]!] ?? PERM_PALETTE.roles!
  return `background:${palette.bg};color:${palette.color}`
}
</script>

<template>
  <div>
    <div class="mb-[22px]">
      <h1 class="text-[26px] font-bold tracking-tight text-ink">Roles</h1>
      <p class="mt-1 text-sm text-muted">
        Roles are schema-defined and read-only. Use the CLI to modify them.
      </p>
    </div>

    <div
      v-if="roles.length === 0"
      class="rounded-2xl border border-dashed border-gray-300 p-12 text-center text-sm text-muted"
    >
      No roles configured.
    </div>

    <div v-else class="flex flex-col gap-4">
      <div
        v-for="role in roles"
        :key="role.name"
        class="rounded-2xl border border-card-border bg-white p-5 shadow-[0_1px_2px_rgba(24,24,48,0.04),0_8px_22px_rgba(24,24,48,0.04)]"
      >
        <!-- Role header -->
        <div class="mb-3.5 flex items-start justify-between gap-3">
          <div>
            <h2 class="text-[16.5px] font-bold tracking-tight text-ink">{{ role.label }}</h2>
            <p class="mt-0.5 font-mono text-[12.5px] text-faint">{{ role.name }}</p>
          </div>
          <span class="shrink-0 whitespace-nowrap rounded-full bg-[#F1F2F6] px-[11px] py-1.5 text-[11.5px] font-semibold text-[#5A6478]">
            {{ role.hierarchy_level === 1 ? 'Level 1' : `Level ${role.hierarchy_level}` }}
          </span>
        </div>

        <!-- Permissions -->
        <div>
          <p class="mb-[9px] text-[11px] font-bold uppercase tracking-[.06em] text-[#B0B0C0]">
            Permissions
          </p>
          <div
            v-if="role.permissions.length === 0"
            class="text-xs text-faint"
          >
            No permissions assigned.
          </div>
          <div v-else class="flex flex-wrap gap-[7px]">
            <span
              v-for="perm in role.permissions"
              :key="perm"
              class="rounded-[7px] px-2.5 py-1 font-mono text-[11.5px] font-medium"
              :style="permStyle(perm)"
            >
              {{ perm }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
