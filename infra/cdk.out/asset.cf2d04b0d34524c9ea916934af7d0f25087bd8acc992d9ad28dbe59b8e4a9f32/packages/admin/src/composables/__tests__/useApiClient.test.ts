import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '../../test-utils/server'
import { useApiClient } from '../useApiClient'
import { useAuthStore } from '../../stores/auth'

const mockPush = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const ADMIN = '/admin'

beforeEach(() => {
  setActivePinia(createPinia())
  mockPush.mockClear()
})

describe('useApiClient', () => {
  it('successful GET returns { ok: true, data: ... }', async () => {
    server.use(
      http.get(`${ADMIN}/api/items`, () =>
        HttpResponse.json({ ok: true, data: [{ id: 1, name: 'test' }] })
      )
    )
    const { get } = useApiClient()
    const result = await get<{ id: number; name: string }[]>('/items')
    expect(result).toEqual({ ok: true, data: [{ id: 1, name: 'test' }] })
  })

  it('401 → triggers refresh → if refresh succeeds → original call retried', async () => {
    let getCallCount = 0
    server.use(
      http.get(`${ADMIN}/api/protected`, () => {
        getCallCount++
        if (getCallCount === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json({ ok: true, data: 'retry-result' })
      }),
      http.post(`${ADMIN}/api/auth/refresh`, () => new HttpResponse(null, { status: 200 }))
    )
    const { get } = useApiClient()
    const result = await get('/protected')

    // Refresh was attempted and retry succeeded
    expect(getCallCount).toBe(2)
    expect(result).toEqual({ ok: true, data: 'retry-result' })
  })

  it('401 on retry (isRetrying=true) → no further refresh attempt — only one retry maximum', async () => {
    let refreshCount = 0
    server.use(
      // All calls to the resource return 401
      http.get(`${ADMIN}/api/protected`, () =>
        HttpResponse.json(
          { ok: false, error: { code: 'UNAUTHORIZED', message: 'Session expired.' } },
          { status: 401 }
        )
      ),
      http.post(`${ADMIN}/api/auth/refresh`, () => {
        refreshCount++
        return new HttpResponse(null, { status: 200 })
      })
    )
    const { get } = useApiClient()
    await get('/protected')

    // Refresh was attempted exactly once: for the first 401.
    // The retry also got 401 but isRetrying=true, so no second refresh.
    expect(refreshCount).toBe(1)
  })

  it('failed refresh → authStore.clear() called and redirect to login', async () => {
    server.use(
      http.get(`${ADMIN}/api/protected`, () => new HttpResponse(null, { status: 401 })),
      // Refresh endpoint returns 401 → refresh fails
      http.post(`${ADMIN}/api/auth/refresh`, () => new HttpResponse(null, { status: 401 }))
    )
    const authStore = useAuthStore()
    authStore.setUser({ id: 'u1', email: 'test@test.local', role: 'editor' })
    const clearSpy = vi.spyOn(authStore, 'clear')

    const { get } = useApiClient()
    await get('/protected')

    expect(clearSpy).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith(`${ADMIN}/login`)
  })
})
