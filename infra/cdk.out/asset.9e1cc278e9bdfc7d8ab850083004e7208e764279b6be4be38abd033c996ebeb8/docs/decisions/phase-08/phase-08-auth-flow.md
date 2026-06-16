# Decision — Auth Flow and Login Page

> Defines first-load auth check, login form behavior, must_change_password redirect, and navigation guards.

---

## First Load — Auth Probe

`App.vue` calls `GET /admin/api/config` in `onMounted` before any route renders. A `loading` ref prevents the router-view from rendering until the probe resolves.

```
App mounts
  ↓
loading = true
  ↓
GET /admin/api/config
  ├── 401 → authStore.clear() → router.push('/admin/login') → loading = false
  └── 200 → populate auth store + schema store + ui store → loading = false
              ↓
              check must_change_password
              ├── true  → router.push('/admin/change-password')
              └── false → let router proceed to intended route
```

Loading state renders a neutral full-screen spinner — not a skeleton, not a blank screen.

`GET /admin/api/auth/me` is not needed. The config endpoint covers user identity. This endpoint is explicitly excluded from the admin panel.

---

## Login Form

Route: `/admin/login` — public, no auth middleware.

Fields: email + password. Submit button disabled while request is in flight.

**Error handling:**

| Error code | UI behavior |
|---|---|
| `INVALID_CREDENTIALS` | Inline error below form: "Invalid email or password." |
| `RATE_LIMITED` | Read `Retry-After` header. Show: "Too many attempts. Try again in X minutes." Disable submit button with countdown until window expires. |
| Network error | Inline error: "Something went wrong. Please try again." |

On success → populate `auth` store from login response → check `must_change_password` → navigate.

---

## Post-Login Navigation

After successful login:

```
must_change_password === true
  → navigate to /admin/change-password

must_change_password === false
  → check for ?redirect= query param (set by navigation guard)
    ├── present → navigate to redirect destination
    └── absent  → navigate to first content type list view
```

---

## Change Password View

Route: `/admin/change-password` — authenticated, no sidebar/nav chrome.

Renders only the change password form. No way to navigate elsewhere until the password is changed.

On success: the change-password endpoint response returns the updated user object. Auth store updates `must_change_password = false` from the response — no extra API call needed. Navigation guard then allows normal navigation.

---

## Navigation Guards

Two guards on the router, both using `__ADMIN_PREFIX__`:

### Global Auth Guard

Runs before every navigation:

```ts
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // already authenticated — redirect away from login
  if (to.path === `${__ADMIN_PREFIX__}/login`) {
    if (auth.isAuthenticated) return { path: `${__ADMIN_PREFIX__}/` }
    return true
  }

  // not authenticated — preserve intended destination
  if (!auth.isAuthenticated) {
    return {
      path: `${__ADMIN_PREFIX__}/login`,
      query: { redirect: to.fullPath }
    }
  }

  // must change password — force redirect
  if (auth.mustChangePassword && to.path !== `${__ADMIN_PREFIX__}/change-password`) {
    return { path: `${__ADMIN_PREFIX__}/change-password` }
  }

  // password already changed — redirect away from change-password
  if (!auth.mustChangePassword && to.path === `${__ADMIN_PREFIX__}/change-password`) {
    return { path: `${__ADMIN_PREFIX__}/` }
  }

  return true
})
```

### Permission Guard

Runs on routes with `meta.permission`:

```ts
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.permission && !auth.hasPermission(to.meta.permission)) {
    return { path: `${__ADMIN_PREFIX__}/` }  // redirect to home, not login
  }
})
```

Unauthorized permission redirect goes to home — not login — since the user is already authenticated.

---

## Mid-Session 401 Handling

Handled entirely by `useApiClient` — see [phase-08-api-client.md](./phase-08-api-client.md). The login page and navigation guards do not need to handle this case.

---

## `GET /admin/api/auth/me` — Not Implemented

This endpoint is redundant given that `GET /admin/api/config` returns full user info. It must not be added during Phase 8 implementation.
