import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '../../src/test-utils/server'
import { useAuthStore } from '../../src/stores/auth'
import LoginView from '../../src/views/LoginView.vue'

const ADMIN = '/admin'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: `${ADMIN}/login`, name: 'login', component: { template: '<div/>' } },
      { path: `${ADMIN}/`, name: 'home', component: { template: '<div/>' } },
      { path: `${ADMIN}/change-password`, name: 'change-password', component: { template: '<div/>' } },
    ],
  })
}

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

async function submitForm(wrapper: ReturnType<typeof mount>, email = 'user@test.local', password = 'secret') {
  await wrapper.find('#email').setValue(email)
  await wrapper.find('#password').setValue(password)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('LoginView', () => {
  it('INVALID_CREDENTIALS response: shows "Invalid email or password." error', async () => {
    server.use(
      http.post(`${ADMIN}/api/auth/login`, () =>
        HttpResponse.json({ ok: false, error: { code: 'INVALID_CREDENTIALS' } }, { status: 401 })
      )
    )
    const router = createTestRouter()
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } })
    await submitForm(wrapper)

    expect(wrapper.text()).toContain('Invalid email or password.')
  })

  it('RATE_LIMITED response: countdown message shown and submit button disabled', async () => {
    vi.useFakeTimers()
    server.use(
      http.post(`${ADMIN}/api/auth/login`, () =>
        HttpResponse.json(
          { ok: false, error: { code: 'RATE_LIMITED' } },
          { status: 429, headers: { 'Retry-After': '120' } }
        )
      )
    )
    const router = createTestRouter()
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } })
    await submitForm(wrapper)

    expect(wrapper.text()).toContain('Too many attempts')
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()

    vi.useRealTimers()
  })

  it('successful login: auth store populated and navigation triggered', async () => {
    server.use(
      http.post(`${ADMIN}/api/auth/login`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            id: 'user-1',
            email: 'user@test.local',
            role: 'editor',
            must_change_password: false,
          },
        })
      )
    )
    const router = createTestRouter()
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } })
    await submitForm(wrapper)

    const authStore = useAuthStore()
    expect(authStore.id).toBe('user-1')
    expect(authStore.email).toBe('user@test.local')
    expect(authStore.role).toBe('editor')
    expect(pushSpy).toHaveBeenCalled()
  })
})
