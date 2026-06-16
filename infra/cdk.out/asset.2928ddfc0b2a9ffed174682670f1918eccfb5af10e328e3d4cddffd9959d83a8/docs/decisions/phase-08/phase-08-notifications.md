# Decision — Notifications and Error UX

> Defines the toast system, inline error pattern, error code mapping, and `useNotification` composable.

---

## Two Categories of Feedback

| Category | When to use | Examples |
|----------|-------------|---------|
| **Toast** | Global, transient — user should know but not blocked | Save success, delete success, non-form API errors, session expiry |
| **Inline error** | Contextual — belongs to a specific field or form action | Field validation, `SLUG_CONFLICT`, login errors, `RATE_LIMITED` |

**Rule:** If it belongs to a form field or form action, it's inline. Everything else is a toast.

---

## Toast System — `ui` Store

```ts
type ToastVariant = 'success' | 'error' | 'warning' | 'info'

type Toast = {
  id: string            // crypto.randomUUID()
  variant: ToastVariant
  message: string
  duration: number | null  // ms — null = persistent until dismissed
}
```

- Default duration: 4000ms
- `null` duration: persistent — user must dismiss manually
- Max 3 toasts visible simultaneously — oldest dismissed when 4th arrives
- `ToastContainer.vue` in `AppShell.vue` renders the stack

---

## `useNotification` Composable

All stores and components use this — never access `ui` store directly for notifications:

```ts
// composables/useNotification.ts
export function useNotification() {
  const ui = useUiStore()

  return {
    success: (message: string) => ui.addToast('success', message),
    error: (message: string) => ui.addToast('error', message),
    warning: (message: string) => ui.addToast('warning', message),
    apiError: (code: string, fallback: string) =>
      ui.addToast('error', ERROR_MESSAGES[code] ?? fallback),
  }
}
```

Usage in store actions:

```ts
const { success, apiError } = useNotification()

const result = await post(`/content/${type}`, data)
if (result.ok) {
  success('Content saved.')
} else {
  apiError(result.error.code, result.error.message)
}
```

---

## Error Code → Message Map

Codes where the raw API message is not suitable for end users:

```ts
const ERROR_MESSAGES: Partial<Record<string, string>> = {
  INTERNAL_ERROR:           'Something went wrong. Please try again.',
  NOT_FOUND:                'The requested item could not be found.',
  STORAGE_ERROR:            'File storage is unavailable. Please try again later.',
  MEDIA_IN_USE:             'This file is still in use and cannot be deleted.',
  INSUFFICIENT_PERMISSION:  'You do not have permission to do that.',
  RATE_LIMITED:             'Too many requests. Please wait before trying again.',
}
```

Unmapped codes fall back to `result.error.message` directly.

---

## Error Codes That Are Never Toasted

These codes are handled by dedicated UI — never passed to `useNotification`:

| Code | Handled by |
|------|------------|
| `INVALID_CREDENTIALS` | Login form inline error |
| `RATE_LIMITED` (login) | Login form countdown + disabled button |
| `VALIDATION_ERROR` | `useFormValidation` → field inline errors |
| `PUBLISH_VALIDATION_ERROR` | `useFormValidation` → field inline errors |
| `SLUG_CONFLICT` | `useFormValidation` → slug field inline error |
| `UNAUTHORIZED` | `useApiClient` → redirect to login |
| `TOKEN_EXPIRED` | `useApiClient` → refresh attempt → redirect |
| `TOKEN_INVALID` | `useApiClient` → redirect to login |
| `PASSWORD_CHANGE_REQUIRED` | Navigation guard → redirect to change-password |

---

## `useFormValidation` — Single Source of Field Error State

Field components never care whether an error came from client-side validation or a server response. `useFormValidation` is the single source of truth for all field error state:

- **Client-side errors**: set on blur, cleared on input change
- **Server-side errors** (`PUBLISH_VALIDATION_ERROR` details, `SLUG_CONFLICT`): merged into the same `errors` map after API response

Field components receive `error` as a prop — they render it without knowing its origin.

```ts
// useFormValidation merges server errors after submit
function mergeServerErrors(details: Array<{ field: string; message: string }>) {
  for (const { field, message } of details) {
    errors.value[field] = message
  }
}
```
