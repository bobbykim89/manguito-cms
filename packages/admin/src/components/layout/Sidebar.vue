<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSchemaStore } from '../../stores/schema'
import { useAuthStore } from '../../stores/auth'
import { useUiStore } from '../../stores/ui'
import { usePermission } from '../../composables/usePermission'
import { useApiClient } from '../../composables/useApiClient'

const schema = useSchemaStore()
const authStore = useAuthStore()
const uiStore = useUiStore()
const { can } = usePermission()
const router = useRouter()
const api = useApiClient()

const contentTypeList = computed(() => Object.values(schema.contentTypes))
const taxonomyTypeList = computed(() => Object.values(schema.taxonomyTypes))

const roleLabel = computed(() => {
  if (!authStore.role) return null
  return schema.getRoleByName(authStore.role)?.label ?? authStore.role
})

const contentOpen = ref(true)
const taxonomyOpen = ref(true)

// On mobile the rail is always rendered at full width inside the drawer.
const collapsed = computed(() => !uiStore.isMobile && uiStore.sidebarCollapsed)

const adminPrefix = __ADMIN_PREFIX__

async function logout() {
  await api.post('/auth/logout', {})
  authStore.clear()
  router.push(`${adminPrefix}/login`)
}

function userInitial(): string {
  return authStore.email ? authStore.email.charAt(0).toUpperCase() : '?'
}
</script>

<template>
  <aside
    :class="[
      'flex h-full flex-col border-r border-card-border bg-white transition-[width] duration-300',
      uiStore.isMobile
        ? 'fixed inset-y-0 left-0 z-50 w-[258px] shadow-2xl transition-transform duration-300'
        : 'relative shrink-0 overflow-hidden',
      uiStore.isMobile && !uiStore.mobileNavOpen ? '-translate-x-full' : 'translate-x-0',
      !uiStore.isMobile && (collapsed ? 'w-[74px]' : 'w-[258px]'),
    ]"
    aria-label="Main navigation"
  >
    <!-- Brand -->
    <div class="flex items-center gap-[11px] px-[17px] pb-[14px] pt-[18px]">
      <div
        class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#6D5EF0] to-[#5B57E8] shadow-[0_4px_12px_rgba(91,87,232,0.36)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round">
          <path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h13" />
        </svg>
      </div>
      <div v-if="!collapsed" class="overflow-hidden">
        <div class="whitespace-nowrap text-[15px] font-bold tracking-tight text-ink">
          {{ uiStore.cmsName }}
        </div>
        <div class="whitespace-nowrap text-[11px] font-medium text-faint">Admin panel</div>
      </div>
    </div>

    <!-- Scrollable nav -->
    <div class="flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-2.5 pt-1">
      <!-- Content group -->
      <div>
        <button
          v-if="!collapsed"
          type="button"
          class="mb-1 mt-4 flex w-full items-center justify-between px-2 text-[11px] font-bold uppercase tracking-[.09em] text-faint hover:text-muted"
          :aria-expanded="contentOpen"
          @click="contentOpen = !contentOpen"
        >
          <span>Content</span>
          <svg
            class="h-3 w-3 text-[#C2C2D0] transition-transform"
            :class="contentOpen ? '' : '-rotate-90'"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <template v-if="collapsed || contentOpen">
          <RouterLink
            v-for="type in contentTypeList"
            :key="type.name"
            :to="`${adminPrefix}/content/${type.name}`"
            :class="[
              'my-0.5 flex items-center rounded-[10px] text-sm font-medium text-[#4A4A60] transition-colors hover:bg-[#F3F2F8]',
              collapsed ? 'justify-center px-0 py-[11px]' : 'gap-3 px-3 py-2.5',
            ]"
            active-class="!bg-indigo-50 !text-indigo-600 !font-semibold"
          >
            <span class="flex shrink-0">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a2 2 0 0 0 2 2h4" /><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M9 13h6" /><path d="M9 17h5" />
              </svg>
            </span>
            <span v-if="!collapsed" class="overflow-hidden whitespace-nowrap">{{ type.label }}</span>
          </RouterLink>
        </template>
      </div>

      <!-- Taxonomy group -->
      <div v-if="taxonomyTypeList.length > 0">
        <button
          v-if="!collapsed"
          type="button"
          class="mb-1 mt-4 flex w-full items-center justify-between px-2 text-[11px] font-bold uppercase tracking-[.09em] text-faint hover:text-muted"
          :aria-expanded="taxonomyOpen"
          @click="taxonomyOpen = !taxonomyOpen"
        >
          <span>Taxonomy</span>
          <svg
            class="h-3 w-3 text-[#C2C2D0] transition-transform"
            :class="taxonomyOpen ? '' : '-rotate-90'"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <template v-if="collapsed || taxonomyOpen">
          <RouterLink
            v-for="type in taxonomyTypeList"
            :key="type.name"
            :to="`${adminPrefix}/taxonomy/${type.name}`"
            :class="[
              'my-0.5 flex items-center rounded-[10px] text-sm font-medium text-[#4A4A60] transition-colors hover:bg-[#F3F2F8]',
              collapsed ? 'justify-center px-0 py-[11px]' : 'gap-3 px-3 py-2.5',
            ]"
            active-class="!bg-indigo-50 !text-indigo-600 !font-semibold"
          >
            <span class="flex shrink-0">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><path d="M7 7h.01" />
              </svg>
            </span>
            <span v-if="!collapsed" class="overflow-hidden whitespace-nowrap">{{ type.label }}</span>
          </RouterLink>
        </template>
      </div>

      <div class="my-3.5 mx-2.5 h-px bg-divider" />

      <!-- Solo items -->
      <RouterLink
        v-if="can('media:read')"
        :to="`${adminPrefix}/media`"
        :class="[
          'my-0.5 flex items-center rounded-[10px] text-sm font-medium text-[#4A4A60] transition-colors hover:bg-[#F3F2F8]',
          collapsed ? 'justify-center px-0 py-[11px]' : 'gap-3 px-3 py-2.5',
        ]"
        active-class="!bg-indigo-50 !text-indigo-600 !font-semibold"
      >
        <span class="flex shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /><path d="M21 15l-5-5L5 21" />
          </svg>
        </span>
        <span v-if="!collapsed" class="overflow-hidden whitespace-nowrap">Media</span>
      </RouterLink>

      <RouterLink
        v-if="can('users:read')"
        :to="`${adminPrefix}/users`"
        :class="[
          'my-0.5 flex items-center rounded-[10px] text-sm font-medium text-[#4A4A60] transition-colors hover:bg-[#F3F2F8]',
          collapsed ? 'justify-center px-0 py-[11px]' : 'gap-3 px-3 py-2.5',
        ]"
        active-class="!bg-indigo-50 !text-indigo-600 !font-semibold"
      >
        <span class="flex shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" />
          </svg>
        </span>
        <span v-if="!collapsed" class="overflow-hidden whitespace-nowrap">Users</span>
      </RouterLink>

      <RouterLink
        v-if="can('roles:read')"
        :to="`${adminPrefix}/roles`"
        :class="[
          'my-0.5 flex items-center rounded-[10px] text-sm font-medium text-[#4A4A60] transition-colors hover:bg-[#F3F2F8]',
          collapsed ? 'justify-center px-0 py-[11px]' : 'gap-3 px-3 py-2.5',
        ]"
        active-class="!bg-indigo-50 !text-indigo-600 !font-semibold"
      >
        <span class="flex shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </span>
        <span v-if="!collapsed" class="overflow-hidden whitespace-nowrap">Roles</span>
      </RouterLink>
    </div>

    <!-- Footer: user + logout -->
    <div class="border-t border-divider p-3">
      <div class="flex items-center gap-2.5 p-1.5">
        <div
          class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#6D5EF0] to-[#A06BF0] text-[14px] font-bold text-white"
        >
          {{ userInitial() }}
        </div>
        <div v-if="!collapsed" class="overflow-hidden">
          <div class="whitespace-nowrap text-[13px] font-semibold text-[#2C2C44]">{{ authStore.email }}</div>
          <div v-if="roleLabel" class="whitespace-nowrap text-[11.5px] text-[#9A9AB0]">{{ roleLabel }}</div>
        </div>
      </div>
      <button
        type="button"
        :class="[
          'mt-1 flex w-full items-center rounded-[10px] py-[9px] text-left text-[13.5px] font-medium text-[#74748C] transition-colors hover:bg-[#FDF2F4] hover:text-[#E1495B]',
          collapsed ? 'justify-center px-0' : 'gap-[11px] px-2',
        ]"
        @click="logout"
      >
        <span class="flex shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
          </svg>
        </span>
        <span v-if="!collapsed" class="whitespace-nowrap">Log out</span>
      </button>
    </div>
  </aside>
</template>
