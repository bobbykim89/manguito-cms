import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'

// ─── Route meta typing ────────────────────────────────────────────────────────

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    permission?: string
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
// All paths include __ADMIN_PREFIX__ so to.path in guards matches without stripping.

const routes: RouteRecordRaw[] = [
  // ── Public ────────────────────────────────────────────────────────────────
  {
    path: `${__ADMIN_PREFIX__}/login`,
    name: 'login',
    component: () => import('../views/LoginView.vue'),
  },

  // ── Auth required ─────────────────────────────────────────────────────────
  {
    path: `${__ADMIN_PREFIX__}/change-password`,
    name: 'change-password',
    component: () => import('../views/ChangePasswordView.vue'),
    meta: { requiresAuth: true },
  },

  // ── Content ───────────────────────────────────────────────────────────────
  // Define /new and /settings before /:id so static segments win over dynamic ones.
  {
    path: `${__ADMIN_PREFIX__}/content/:type`,
    name: 'content-list',
    component: () => import('../views/content/ContentListView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: `${__ADMIN_PREFIX__}/content/:type/new`,
    name: 'content-new',
    component: () => import('../views/content/ContentFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: `${__ADMIN_PREFIX__}/content/:type/settings`,
    name: 'content-settings',
    component: () => import('../views/content/ContentSettingsView.vue'),
    meta: { requiresAuth: true, permission: 'content:edit' },
  },
  {
    path: `${__ADMIN_PREFIX__}/content/:type/:id`,
    name: 'content-edit',
    component: () => import('../views/content/ContentFormView.vue'),
    meta: { requiresAuth: true },
  },

  // ── Taxonomy ──────────────────────────────────────────────────────────────
  {
    path: `${__ADMIN_PREFIX__}/taxonomy/:type`,
    name: 'taxonomy-list',
    component: () => import('../views/taxonomy/TaxonomyListView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: `${__ADMIN_PREFIX__}/taxonomy/:type/new`,
    name: 'taxonomy-new',
    component: () => import('../views/taxonomy/TaxonomyFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: `${__ADMIN_PREFIX__}/taxonomy/:type/:id`,
    name: 'taxonomy-edit',
    component: () => import('../views/taxonomy/TaxonomyFormView.vue'),
    meta: { requiresAuth: true },
  },

  // ── Media ─────────────────────────────────────────────────────────────────
  {
    path: `${__ADMIN_PREFIX__}/media`,
    name: 'media-library',
    component: () => import('../views/media/MediaLibraryView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: `${__ADMIN_PREFIX__}/media/:id`,
    name: 'media-detail',
    component: () => import('../views/media/MediaDetailView.vue'),
    meta: { requiresAuth: true },
  },

  // ── Users — all gated by users:read at the route level ────────────────────
  {
    path: `${__ADMIN_PREFIX__}/users`,
    name: 'user-list',
    component: () => import('../views/users/UserListView.vue'),
    meta: { requiresAuth: true, permission: 'users:read' },
  },
  {
    path: `${__ADMIN_PREFIX__}/users/new`,
    name: 'user-new',
    component: () => import('../views/users/UserFormView.vue'),
    meta: { requiresAuth: true, permission: 'users:read' },
  },
  {
    path: `${__ADMIN_PREFIX__}/users/:id`,
    name: 'user-edit',
    component: () => import('../views/users/UserFormView.vue'),
    meta: { requiresAuth: true, permission: 'users:read' },
  },

  // ── Roles ─────────────────────────────────────────────────────────────────
  {
    path: `${__ADMIN_PREFIX__}/roles`,
    name: 'roles',
    component: () => import('../views/RolesView.vue'),
    meta: { requiresAuth: true },
  },
]

// ─── Router ───────────────────────────────────────────────────────────────────

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// ─── Global auth guard ────────────────────────────────────────────────────────

router.beforeEach((to) => {
  const auth = useAuthStore()

  // Already authenticated — redirect away from login.
  if (to.path === `${__ADMIN_PREFIX__}/login`) {
    if (auth.isAuthenticated) return { path: `${__ADMIN_PREFIX__}/` }
    return true
  }

  // Not authenticated — preserve intended destination as redirect query param.
  if (!auth.isAuthenticated) {
    return {
      path: `${__ADMIN_PREFIX__}/login`,
      query: { redirect: to.fullPath },
    }
  }

  // Must change password — force redirect to change-password.
  if (auth.mustChangePassword && to.path !== `${__ADMIN_PREFIX__}/change-password`) {
    return { path: `${__ADMIN_PREFIX__}/change-password` }
  }

  // Password already changed — redirect away from change-password.
  if (!auth.mustChangePassword && to.path === `${__ADMIN_PREFIX__}/change-password`) {
    return { path: `${__ADMIN_PREFIX__}/` }
  }

  return true
})

// ─── Permission guard ─────────────────────────────────────────────────────────

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.permission && !auth.hasPermission(to.meta.permission)) {
    return { path: `${__ADMIN_PREFIX__}/` }
  }
})

export default router
