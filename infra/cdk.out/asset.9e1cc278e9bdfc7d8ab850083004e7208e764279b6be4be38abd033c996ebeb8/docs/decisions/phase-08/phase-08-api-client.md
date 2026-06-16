# Decision — API Client Layer

> Defines the `useApiClient` composable, 401 retry behavior, prefix resolution, and file upload handling.

---

## Prefix Resolution

Both `__ADMIN_PREFIX__` and `__API_PREFIX__` are injected at build time via Vite `define` — baked into the bundle, not resolved at runtime. See [phase-08-package-structure.md](./phase-08-package-structure.md) for the injection mechanism.

All `useApiClient` calls use these constants directly. No bootstrap fetch is needed to discover prefixes.

---

## `useApiClient` — Regular Composable

`useApiClient` is a regular Vue composable, not a Pinia store. The 401 retry race condition (two concurrent requests both getting 401 and both attempting refresh) is not a meaningful risk with httpOnly cookies — a duplicate refresh call simply reissues an equivalent fresh cookie with no corrupted state.

```ts
// composables/useApiClient.ts
export function useApiClient() {
  const authStore = useAuthStore()

  async function request<T>(
    path: string,
    options?: RequestInit,
    isRetrying = false
  ): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }> {
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

    return response.json()
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
```

---

## 401 Retry — Infinite Loop Prevention

The `isRetrying` flag prevents infinite loops:

1. First call returns 401 → attempt refresh → retry with `isRetrying = true`
2. Retry returns 401 → `isRetrying` is `true` → skip refresh, redirect to login immediately

Maximum two requests per original call. No loop possible.

---

## File Uploads — `MediaUpload.vue` Handles Independently

`useApiClient` is JSON-only. File uploads use `multipart/form-data` and happen at exactly one place — `MediaUpload.vue` talking to `/admin/api/media/*`. Since uploads are not a repeating pattern across the app, `MediaUpload.vue` owns its own `fetch` call directly.

**Why `XMLHttpRequest` instead of `fetch` for uploads:**
`fetch` does not support upload progress events. `XMLHttpRequest` with `upload.onprogress` provides a real progress bar for both direct and presigned upload flows.

If a media upload returns 401, the component shows an error message — no silent retry needed since uploads are deliberate, user-initiated actions.

---

## Config Bootstrap — `GET /admin/api/config`

On app load, `App.vue` calls `GET /admin/api/config` (using the hardcoded `__ADMIN_PREFIX__` constant) to both verify auth state and bootstrap the app:

- **401** → not authenticated → redirect to login
- **200** → authenticated → populate stores from response

Config response shape:

```ts
type ConfigResponse = {
  cms_name: string
  version: string
  roles: ParsedRole[]
  user: {
    id: string
    email: string
    role: string
    must_change_password: boolean
  }
  media: {
    max_file_size: number   // bytes
  }
}
```

`GET /admin/api/auth/me` is not needed — the config endpoint covers it. This endpoint was explicitly excluded to avoid redundancy.

---

## Store Responsibilities After Bootstrap

| Data | Store |
|------|-------|
| `user.id`, `user.email`, `user.role`, `user.must_change_password` | `auth` store |
| `roles`, schema registry | `schema` store |
| `media.max_file_size`, `cms_name`, `version` | `ui` store |
