import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export function useApiClient() {
  const router = useRouter()
  const authStore = useAuthStore()

  async function request<T>(
    path: string,
    options?: RequestInit,
    isRetrying = false
  ): Promise<ApiResult<T>> {
    const response = await fetch(`${__ADMIN_PREFIX__}/api${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (response.status === 401 && !isRetrying) {
      const refreshed = await tryRefresh()
      if (!refreshed) {
        authStore.clear()
        router.push(`${__ADMIN_PREFIX__}/login`)
        return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Session expired.' } }
      }
      return request<T>(path, options, true)
    }

    return response.json() as Promise<ApiResult<T>>
  }

  async function tryRefresh(): Promise<boolean> {
    const res = await fetch(`${__ADMIN_PREFIX__}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  }

  function get<T>(path: string) {
    return request<T>(path, { method: 'GET' })
  }

  function post<T>(path: string, body: unknown) {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  function patch<T>(path: string, body: unknown) {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
  }

  function put<T>(path: string, body: unknown) {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
  }

  function del(path: string) {
    return request(path, { method: 'DELETE' })
  }

  return { get, post, patch, put, del }
}
