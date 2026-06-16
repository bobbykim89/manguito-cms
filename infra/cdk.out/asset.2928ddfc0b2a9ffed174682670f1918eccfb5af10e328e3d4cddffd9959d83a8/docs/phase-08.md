# Phase 8 — Admin Panel

> Vue 3 SPA admin panel with dynamic dev rendering, static production codegen, and full CRUD for all content types.

This phase builds `@bobbykim/manguito-cms-admin` — the browser-based interface for managing content, taxonomy, media, and users. It consumes the API from Phase 5, the auth system from Phase 6, and produces both a dev-mode dynamic renderer and a build-time static form generator.

**Done when:** The admin panel SPA is functional in dev mode (dynamic renderer). All nine field components are implemented and tested. Auth flow, navigation guards, and role-aware UI are in place. The `generateFormComponent` codegen function produces correct static Vue SFCs for all schema types. All non-negotiable test areas pass.

---

## Decisions Made

| Topic | Detail doc |
|-------|-----------|
| Package structure, subpath export, Vite define | [decisions/phase-08/phase-08-package-structure.md](./decisions/phase-08/phase-08-package-structure.md) |
| API client composable, 401 retry, prefix resolution | [decisions/phase-08/phase-08-api-client.md](./decisions/phase-08/phase-08-api-client.md) |
| Auth flow, login page, navigation guards | [decisions/phase-08/phase-08-auth-flow.md](./decisions/phase-08/phase-08-auth-flow.md) |
| Toast system, inline errors, `useNotification` | [decisions/phase-08/phase-08-notifications.md](./decisions/phase-08/phase-08-notifications.md) |
| Role-aware UI, `usePermission`, store responsibilities | [decisions/phase-08/phase-08-role-aware-ui.md](./decisions/phase-08/phase-08-role-aware-ui.md) |
| Slug editing UX, singleton routing, `ReferenceSelect` typeahead | [decisions/phase-08/phase-08-content-form-ux.md](./decisions/phase-08/phase-08-content-form-ux.md) |
| Media library, media modal, upload flow | [decisions/phase-08/phase-08-media.md](./decisions/phase-08/phase-08-media.md) |
| Static form codegen, generator function, paragraph nesting | [decisions/phase-08/phase-08-codegen.md](./decisions/phase-08/phase-08-codegen.md) |
| Testing strategy, MSW setup, non-negotiable coverage | [decisions/phase-08/phase-08-testing.md](./decisions/phase-08/phase-08-testing.md) |

---

## Where This Fits

```
Phase 6 — auth module complete, full backend functional
Phase 7 — backend test suite complete

Phase 8 — adds:
  packages/admin/src/          ← Vue SPA (Vite)
  packages/admin/codegen/      ← form generator (tsup, CLI-importable)
  .manguito/forms/             ← generated SFCs (written by CLI at dev/build time)

Phase 9 — CLI commands wire manguito dev / build / start lifecycle
Phase 10 — CI/CD pipeline
```

---

## Key Architectural Rules

- `__ADMIN_PREFIX__` and `__API_PREFIX__` are injected at build time via Vite `define` — never hardcoded strings, never runtime fetch
- `GET /admin/api/auth/me` is not implemented — `GET /admin/api/config` covers user identity
- `content:publish` permission does not exist — publish/unpublish uses `content:edit`. This corrects an inconsistency in Phase 5 docs; the authoritative definition is in `phase-02-roles-and-auth-design.md`
- `useApiClient` is a regular composable — not a Pinia store
- File uploads (`MediaUpload.vue`) use `XMLHttpRequest` directly — not `useApiClient`
- Roles list and `hierarchyLevel` live in the `schema` store — not the `auth` store
- Hidden not disabled — UI elements the user cannot act on are hidden entirely
- `useFormValidation` is the single source of truth for all field error state (client-side and server-side)
- Generated SFCs use package imports (`@bobbykim/manguito-cms-admin/src/...`) — not relative imports

---

## Route Table

```
/admin/login                           — public, no auth
/admin/change-password                 — authenticated, no sidebar chrome

/admin/content/:type                   — list view (only_one: false) OR singleton form (only_one: true)
/admin/content/:type/new               — create form (only_one: false only)
/admin/content/:type/:id               — edit form (only_one: false only)
/admin/content/:type/settings          — base_path picker (admin/manager only)

/admin/taxonomy/:type                  — list view
/admin/taxonomy/:type/new              — create form
/admin/taxonomy/:type/:id              — edit form

/admin/media                           — media library
/admin/media/:id                       — media detail, alt text edit

/admin/users                           — user list (users:read)
/admin/users/new                       — create user (users:create)
/admin/users/:id                       — edit user (users:edit)

/admin/roles                           — role list, read-only
```

---

## Developer Checklist

### Setup
- [ ] Add dependencies to `packages/admin/package.json` — Vue 3, Vite, Tailwind, shadcn-vue, Pinia, vue-router, `@tiptap/vue-3`, `@vueuse/core`, `msw`, `@vue/test-utils`, `@testing-library/vue`
- [ ] Configure `vite.config.ts` — placeholder `define` block (CLI will inject real values at runtime)
- [ ] Configure `tsup.config.ts` — `codegen/` entry only, `external: ['vue']`
- [ ] Add subpath exports to `package.json` — `.` and `./codegen`
- [ ] Add `src/env.d.ts` — declare `__ADMIN_PREFIX__` and `__API_PREFIX__`
- [ ] Add `.manguito/` to `.gitignore`

### API Client — see [phase-08-api-client.md](./decisions/phase-08/phase-08-api-client.md)
- [ ] `useApiClient` composable — `get`, `post`, `patch`, `put`, `del` wrappers
- [ ] 401 retry with `isRetrying` flag — max one retry per original call
- [ ] On failed refresh — `authStore.clear()` + redirect to login
- [ ] `GET /admin/api/auth/me` — must not be implemented

### Auth Flow — see [phase-08-auth-flow.md](./decisions/phase-08/phase-08-auth-flow.md)
- [ ] `App.vue` — `loading` ref, `GET /admin/api/config` probe in `onMounted`
- [ ] Populate `auth` store, `schema` store, `ui` store from config response
- [ ] Global auth guard — unauthenticated redirect, `must_change_password` redirect, authenticated redirect away from login
- [ ] Permission guard — unauthorized role redirects to home (not login)
- [ ] `LoginView.vue` — inline `INVALID_CREDENTIALS` error, `RATE_LIMITED` countdown + disabled button
- [ ] `ChangePasswordView.vue` — no sidebar chrome, updates auth store from response on success

### Notifications — see [phase-08-notifications.md](./decisions/phase-08/phase-08-notifications.md)
- [ ] `ui` store — `toasts` array, `addToast`, `removeToast`, max 3 visible, auto-dismiss timer
- [ ] `ToastContainer.vue` in `AppShell.vue`
- [ ] `useNotification` composable — `success`, `error`, `warning`, `apiError`
- [ ] `ERROR_MESSAGES` map — codes where raw API message is not user-friendly
- [ ] `useFormValidation` — `mergeServerErrors()` for `PUBLISH_VALIDATION_ERROR` details

### Role-Aware UI — see [phase-08-role-aware-ui.md](./decisions/phase-08/phase-08-role-aware-ui.md)
- [ ] `usePermission` composable — `can()` and `rolesBelow()`
- [ ] Nav items gated by permission — hidden not disabled
- [ ] Action buttons gated by permission — hidden not disabled
- [ ] Role picker filtered by `hierarchy_level` — `admin` role never shown
- [ ] `content:publish` permission must not appear anywhere — use `content:edit`

### Field Components — see [phase-08-package-structure.md](./decisions/phase-08/phase-08-package-structure.md)
- [ ] All nine field components implement `FieldProps` interface and `v-model` pattern
- [ ] `TextInput.vue` — live slug format helper when `field.name` ends in `_slug` (or is the designated slug field)
- [ ] `ParagraphEmbed.vue` — accepts `formComponent` prop, uses `<component :is="formComponent" />`
- [ ] `ReferenceSelect.vue` — debounced 300ms, min 2 chars, 10 results, chip display, max limit enforcement
- [ ] `MediaUpload.vue` — `XMLHttpRequest` with `upload.onprogress`, direct vs presigned path decision

### Content Form UX — see [phase-08-content-form-ux.md](./decisions/phase-08/phase-08-content-form-ux.md)
- [ ] `ContentFormView.vue` handles create, edit, and singleton modes with conditionals
- [ ] Singleton mode — no slug field, no delete button, always `PUT`
- [ ] Slug field on published content — read-only with "Edit slug" unlock button, single confirmation dialog on save
- [ ] `ContentSettingsView.vue` — `base_path` picker from available routes, `admin`/`manager` only

### Media — see [phase-08-media.md](./decisions/phase-08/phase-08-media.md)
- [ ] `MediaLibraryView.vue` — filter tabs, orphaned tab with bulk delete, pagination
- [ ] `MediaDetailView.vue` — metadata, alt text edit, reference count, delete button
- [ ] `MediaSelectModal.vue` — shared grid, pre-filtered and locked by field type, "Select" confirm
- [ ] `MediaUpload.vue` — `max_file_size` from `ui` store, direct vs presigned decision, `XMLHttpRequest` progress
- [ ] Alt text optional for images, required for video/PDF

### Codegen — see [phase-08-codegen.md](./decisions/phase-08/phase-08-codegen.md)
- [ ] `generateFormComponent()` pure function in `codegen/form-generator.ts`
- [ ] Exports via `codegen/index.ts` — consumed by CLI via `./codegen` subpath
- [ ] Generates correct SFC string for content type (with tabs), paragraph type (flat), taxonomy type (flat)
- [ ] Paragraph fields import generated paragraph SFC and pass as `formComponent` prop
- [ ] Nested paragraph (one level deep) handled correctly
- [ ] Generated SFCs include `<!-- AUTO-GENERATED -->` comment header

### Testing — see [phase-08-testing.md](./decisions/phase-08/phase-08-testing.md)
- [ ] MSW setup in `tests/setup.ts` — default config handler, `beforeAll`/`afterEach`/`afterAll` lifecycle
- [ ] All nine field components — `v-model`, error display, disabled state
- [ ] `useFormValidation` — client validation, server error merge
- [ ] `useApiClient` — 401 retry, redirect on failed refresh
- [ ] `usePermission` — `can()`, `rolesBelow()`
- [ ] Navigation guards — auth redirect, `must_change_password` redirect
- [ ] `generateFormComponent` — snapshot test for content, paragraph, taxonomy schema fixtures

---

## Claude Code Checklist

- [ ] Read all detail docs linked in the Decisions Made table before implementing
- [ ] `__ADMIN_PREFIX__` and `__API_PREFIX__` are Vite `define` constants — never use hardcoded strings like `'/admin'` or `'/api'` anywhere in `src/`
- [ ] `GET /admin/api/auth/me` must not be implemented — config endpoint covers user identity
- [ ] `content:publish` does not exist as a permission — any occurrence in Phase 5 docs is an error; use `content:edit` for publish/unpublish actions
- [ ] `useApiClient` is a regular composable — do not convert to a Pinia store
- [ ] `MediaUpload.vue` uses `XMLHttpRequest` directly — do not use `useApiClient` for file uploads
- [ ] Roles list lives in `schema` store — do not put it in `auth` store
- [ ] Hidden not disabled — use `v-if` not `disabled` or `:disabled` for permission-gated elements
- [ ] `useFormValidation` handles both client and server field errors — do not handle server errors separately in stores or views
- [ ] Generated SFCs use package imports — do not use relative paths like `../../src/components/...`
- [ ] `ParagraphEmbed.vue` must accept `formComponent` as a Vue `Component` prop — dynamic component pattern `<component :is="formComponent" />`
- [ ] Snapshot tests for codegen must use `toMatchSnapshot()` on the string output — do not render the component and snapshot DOM
- [ ] Never commit snapshot updates without reviewing the full diff
