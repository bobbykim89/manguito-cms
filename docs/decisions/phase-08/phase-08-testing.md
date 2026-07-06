# Decision — Admin Panel Testing Strategy

> Defines tools, test organization, what to test, non-negotiable areas, and MSW setup for the admin package.

---

## Tools

| Tool | Purpose |
|------|---------|
| Vitest | Test runner — consistent with the rest of the monorepo |
| `@vue/test-utils` | Vue 3 component mounting and interaction |
| `@testing-library/vue` | User-behavior focused queries (find by label, click, type) |
| `msw` (Mock Service Worker) | Intercepts `fetch` at the network level — tests real composable behavior |

---

## Test Organization

Follows the same pattern as Phase 7:

```
packages/admin/
├── src/
│   ├── components/
│   │   └── fields/
│   │       ├── TextInput.vue
│   │       └── __tests__/
│   │           └── TextInput.test.ts       ← unit tests beside source
│   └── composables/
│       ├── useFormValidation.ts
│       └── __tests__/
│           └── useFormValidation.test.ts
└── tests/
    ├── setup.ts                            ← MSW server setup
    └── views/
        ├── login.test.ts                   ← view-level behavior tests
        └── content-form.test.ts
```

---

## MSW Setup

MSW runs in Node mode for Vitest (not browser service worker mode):

```ts
// tests/setup.ts
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const server = setupServer(
  http.get(`${__ADMIN_PREFIX__}/api/config`, () =>
    HttpResponse.json({
      ok: true,
      data: {
        cms_name: 'Test CMS',
        version: '1.0.0',
        roles: testRoles,
        user: testUser,
        media: { max_file_size: 4194304 }
      }
    })
  )
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

Per-test handlers override defaults using `server.use(...)` for specific scenarios (401, validation errors, conflict responses, etc.).

---

## What to Test

### Field Components (unit)
- Correct rendering per field type
- `v-model` behavior — `update:modelValue` emitted with correct value
- Error prop display — inline error renders when `error` prop is set
- Disabled state — input not interactive when `disabled` is true
- Edge cases per field type (e.g. `EnumSelect` with no options, `NumberInput` min/max)

### Composables (unit)
- `useFormValidation` — client-side validation rules, server error merging, blur behavior, publish vs draft distinction
- `useDirtyState` — dirty flag set/cleared correctly, `confirmNavigation` behavior
- `usePermission` — `can()` returns correct boolean per role, `rolesBelow()` filters correctly
- `useApiClient` — 401 retry with `isRetrying` flag, redirect on failed refresh (use MSW to simulate 401 responses)

### Views (behavior)
- Login flow — `INVALID_CREDENTIALS` shows inline error, `RATE_LIMITED` shows countdown and disables button
- Auth guard — unauthenticated navigation redirects to login, `must_change_password` redirects to change-password
- `ContentFormView` — singleton mode hides slug and delete, regular mode shows both

### Codegen (snapshot)
- `generateFormComponent` — one snapshot test per schema type (content, paragraph, taxonomy)
- Snapshot the string output directly — see [phase-08-codegen.md](./phase-08-codegen.md)

---

## What NOT to Test

| Thing | Reason |
|-------|--------|
| Pinia store internals directly | Test through component behavior instead |
| Tiptap editor internals | Third-party library |
| CSS / visual layout | Wrong layer for automated tests |
| `ParagraphEmbed` drag-and-drop ordering | Too coupled to DOM simulation, unreliable in jsdom |

---

## Non-Negotiable Coverage Areas

| Area | Reason |
|------|--------|
| `useFormValidation` — client + server error merging | Core to all form behavior |
| `useApiClient` — 401 retry + redirect | Silent failures break the whole app |
| Navigation guards — auth redirect, `must_change_password` | Security-adjacent |
| `usePermission` — `can()` and `rolesBelow()` | Role enforcement in UI |
| All nine field components — `v-model` and error display | Foundation of all forms |
| `generateFormComponent` snapshot tests | Catch codegen regressions |

---

## Snapshot Discipline

Same rule as Phase 7: when running `vitest --update-snapshots`, treat the diff review as a mandatory step. Never commit snapshot updates without reviewing the full diff.
