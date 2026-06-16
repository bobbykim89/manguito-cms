import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { http, HttpResponse } from 'msw'
import type { ParsedContentType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { server } from '../../src/test-utils/server'
import { useAuthStore } from '../../src/stores/auth'
import { useSchemaStore } from '../../src/stores/schema'
import ContentFormView from '../../src/views/content/ContentFormView.vue'

const ADMIN = '/admin'

// ─── Shared test roles ────────────────────────────────────────────────────────

const editorRole: ParsedRole = {
  name: 'editor',
  label: 'Editor',
  is_system: false,
  hierarchy_level: 2,
  permissions: [
    'content:read', 'content:create', 'content:edit', 'content:delete',
    'media:read',
  ],
}

// ─── Minimal content type schema ──────────────────────────────────────────────

function makeContentType(only_one: boolean): ParsedContentType {
  return {
    schema_type: 'content-type',
    name: 'content--blog_post',
    label: 'Blog Post',
    source_file: '',
    only_one,
    default_base_path: 'blog',
    system_fields: [],
    fields: [
      {
        name: 'title',
        label: 'Title',
        field_type: 'text/plain',
        required: true,
        nullable: false,
        order: 0,
        validation: { required: true },
        db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
        ui_component: { component: 'text-input' },
      },
    ],
    ui: { tabs: [{ name: 'main', label: 'Main', fields: ['title'] }] },
    db: { table_name: 'content_blog_post', junction_tables: [] },
    api: {
      default_base_path: 'blog',
      http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      collection_path: '/api/blog-post',
      item_path: '/api/blog-post/:slug',
    },
  }
}

// ─── Router factory ───────────────────────────────────────────────────────────

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: `${ADMIN}/login`, name: 'login', component: { template: '<div/>' } },
      { path: `${ADMIN}/change-password`, name: 'change-password', component: { template: '<div/>' } },
      { path: `${ADMIN}/`, name: 'home', component: { template: '<div/>' } },
      {
        path: `${ADMIN}/content/:type`,
        name: 'content-list',
        component: { template: '<div/>' },
        meta: { requiresAuth: true },
      },
      {
        path: `${ADMIN}/content/:type/new`,
        name: 'content-new',
        component: ContentFormView,
        meta: { requiresAuth: true },
      },
      {
        path: `${ADMIN}/content/:type/:id`,
        name: 'content-edit',
        component: ContentFormView,
        meta: { requiresAuth: true },
      },
    ],
  })

  // Replicate the global auth guard from src/router/index.ts
  router.beforeEach((to) => {
    const auth = useAuthStore()

    if (to.path === `${ADMIN}/login`) {
      if (auth.isAuthenticated) return { path: `${ADMIN}/` }
      return true
    }

    if (!auth.isAuthenticated) {
      return { path: `${ADMIN}/login`, query: { redirect: to.fullPath } }
    }

    if (auth.mustChangePassword && to.path !== `${ADMIN}/change-password`) {
      return { path: `${ADMIN}/change-password` }
    }

    if (!auth.mustChangePassword && to.path === `${ADMIN}/change-password`) {
      return { path: `${ADMIN}/` }
    }

    return true
  })

  return router
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let pinia: ReturnType<typeof createPinia>
let authStore: ReturnType<typeof useAuthStore>
let schemaStore: ReturnType<typeof useSchemaStore>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  authStore = useAuthStore()
  schemaStore = useSchemaStore()
  schemaStore.setRoles([editorRole])
  authStore.setUser({ id: 'u1', email: 'editor@test.local', role: 'editor' })
})

// ─── Rendering tests ──────────────────────────────────────────────────────────

describe('ContentFormView rendering', () => {
  it('singleton mode (only_one: true): slug field absent, delete button absent', async () => {
    schemaStore.setSchema(makeContentType(true))

    const router = createTestRouter()
    await router.push(`${ADMIN}/content/content--blog_post/new`)

    const wrapper = mount(ContentFormView, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(wrapper.find('#slug-field').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Delete')
  })

  it('regular mode (only_one: false): slug field present, delete button present with content:delete', async () => {
    schemaStore.setSchema(makeContentType(false))

    server.use(
      http.get(`${ADMIN}/api/content/content--blog_post/test-id`, () =>
        HttpResponse.json({
          ok: true,
          data: { id: 'test-id', title: 'My Post', slug: 'my-post', published: false },
        })
      )
    )

    const router = createTestRouter()
    await router.push(`${ADMIN}/content/content--blog_post/test-id`)

    const wrapper = mount(ContentFormView, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(wrapper.find('#slug-field').exists()).toBe(true)
    expect(wrapper.text()).toContain('Delete')
  })
})

// ─── Navigation guard tests ───────────────────────────────────────────────────

describe('navigation guards', () => {
  it('unauthenticated navigation to /admin/content/:type redirects to /admin/login', async () => {
    // Fresh Pinia with no authenticated user
    setActivePinia(createPinia())

    const router = createTestRouter()
    await router.push(`${ADMIN}/content/content--blog_post`)

    expect(router.currentRoute.value.path).toBe(`${ADMIN}/login`)
  })

  it('must_change_password: true redirects navigation to /admin/change-password', async () => {
    // Set up authenticated user who must change password
    setActivePinia(createPinia())
    const store = useAuthStore()
    store.setUser({ id: 'u1', email: 'editor@test.local', role: 'editor', mustChangePassword: true })

    const router = createTestRouter()
    await router.push(`${ADMIN}/content/content--blog_post`)

    expect(router.currentRoute.value.path).toBe(`${ADMIN}/change-password`)
  })
})
