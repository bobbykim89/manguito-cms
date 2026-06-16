import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppShell from '../components/layout/AppShell.vue'

// ─── Route meta typing ────────────────────────────────────────────────────────

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    permission?: string
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const routes: RouteRecordRaw[] = [
  // ── Public ────────────────────────────────────────────────────────────────
  {
    path: `${__ADMIN_PREFIX__}/login`,
    name: 'login',
    component: () => import('../views/LoginView.vue'),
  },

  // ── Authenticated — all rendered inside the AppShell layout ───────────────
  // AppShell contains the sidebar, topbar, and a <router-view> for the child.
  // meta.requiresAuth on the parent is merged into every child's to.meta.
  {
    path: `${__ADMIN_PREFIX__}`,
    component: AppShell,
    meta: { requiresAuth: true },
    children: [
      // Default landing
      { path: '', redirect: `${__ADMIN_PREFIX__}/media` },

      // Change password
      {
        path: 'change-password',
        name: 'change-password',
        component: () => import('../views/ChangePasswordView.vue'),
      },

      // ── Content ─────────────────────────────────────────────────────────
      // /new and /settings defined before /:id so static segments win.
      {
        path: 'content/:type',
        name: 'content-list',
        component: () => import('../views/content/ContentListView.vue'),
      },
      {
        path: 'content/:type/new',
        name: 'content-new',
        component: () => import('../views/content/ContentFormView.vue'),
      },
      {
        path: 'content/:type/settings',
        name: 'content-settings',
        component: () => import('../views/content/ContentSettingsView.vue'),
        meta: { permission: 'content:edit' },
      },
      {
        path: 'content/:type/:id',
        name: 'content-edit',
        component: () => import('../views/content/ContentFormView.vue'),
      },

      // ── Taxonomy ─────────────────────────────────────────────────────────
      {
        path: 'taxonomy/:type',
        name: 'taxonomy-list',
        component: () => import('../views/taxonomy/TaxonomyListView.vue'),
      },
      {
        path: 'taxonomy/:type/new',
        name: 'taxonomy-new',
        component: () => import('../views/taxonomy/TaxonomyFormView.vue'),
      },
      {
        path: 'taxonomy/:type/:id',
        name: 'taxonomy-edit',
        component: () => import('../views/taxonomy/TaxonomyFormView.vue'),
      },

      // ── Media ─────────────────────────────────────────────────────────────
      {
        path: 'media',
        name: 'media-library',
        component: () => import('../views/media/MediaLibraryView.vue'),
      },
      {
        path: 'media/:id',
        name: 'media-detail',
        component: () => import('../views/media/MediaDetailView.vue'),
      },

      // ── Users ─────────────────────────────────────────────────────────────
      {
        path: 'users',
        name: 'user-list',
        component: () => import('../views/users/UserListView.vue'),
        meta: { permission: 'users:read' },
      },
      {
        path: 'users/new',
        name: 'user-new',
        component: () => import('../views/users/UserFormView.vue'),
        meta: { permission: 'users:read' },
      },
      {
        path: 'users/:id',
        name: 'user-edit',
        component: () => import('../views/users/UserFormView.vue'),
        meta: { permission: 'users:read' },
      },

      // ── Roles ─────────────────────────────────────────────────────────────
      {
        path: 'roles',
        name: 'roles',
        component: () => import('../views/RolesView.vue'),
      },
    ],
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
    if (auth.isAuthenticated) return { path: `${__ADMIN_PREFIX__}/media` }
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
    return { path: `${__ADMIN_PREFIX__}/media` }
  }

  return true
})

// ─── Permission guard ─────────────────────────────────────────────────────────

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.permission && !auth.hasPermission(to.meta.permission)) {
    return { path: `${__ADMIN_PREFIX__}/media` }
  }
})

export default router
