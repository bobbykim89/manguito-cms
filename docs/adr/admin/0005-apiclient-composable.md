---
status: accepted
---

# useApiClient is a plain composable with a bounded one-shot 401-refresh-retry

The API client is a regular Vue composable (`get`/`post`/`patch`/`put`/`del` over `fetch`), not a Pinia store. On a `401`, it attempts a single token refresh and retries the original request once, guarded by an `isRetrying` flag so a second `401` redirects to login instead of looping — at most two requests per call. It does not serialize concurrent refreshes: because tokens are httpOnly cookies ([api 0003](../api/0003-hybrid-jwt-auth.md)), two requests refreshing at once simply each reissue an equivalent cookie with no shared client state to corrupt, so a mutex would add complexity for no benefit.

## Considered Options

- **A Pinia store for the API client** — rejected: there is no cross-component client state to hold; a composable is the lighter, more testable fit (mock `fetch` via MSW).
- **A refresh mutex / request queue** — rejected: the race it would prevent is harmless with httpOnly cookies; the simpler bounded-retry is sufficient.

## Consequences

- File uploads are the one exception: they need `multipart/form-data` and progress events, so `MediaUpload.vue` owns its own `XMLHttpRequest` (`upload.onprogress`) and does not route through `useApiClient`; a `401` there shows an error rather than silently retrying, since uploads are deliberate user actions.
- Auth-related error codes (`UNAUTHORIZED`/`TOKEN_*`) are handled here (redirect/refresh) and never surface as toasts.
