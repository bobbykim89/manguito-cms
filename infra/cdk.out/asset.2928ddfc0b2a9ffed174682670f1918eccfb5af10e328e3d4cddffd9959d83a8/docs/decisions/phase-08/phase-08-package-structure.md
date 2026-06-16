# Decision — Admin Panel Package Structure

> Defines the directory layout for `packages/admin`, the codegen subpath export, and the two-build-tool setup.

---

## Directory Structure

```
packages/admin/
├── src/                                ← Vue SPA — built by Vite
│   ├── main.ts                         ← Vue app entry point
│   ├── App.vue                         ← root component, router-view, loading state
│   │
│   ├── components/
│   │   ├── fields/                     ← one component per field type
│   │   │   ├── TextInput.vue           ← text/plain
│   │   │   ├── RichTextEditor.vue      ← text/rich (Tiptap)
│   │   │   ├── NumberInput.vue         ← integer, float
│   │   │   ├── BooleanToggle.vue       ← boolean
│   │   │   ├── DatePicker.vue          ← date
│   │   │   ├── MediaUpload.vue         ← image, video, file
│   │   │   ├── EnumSelect.vue          ← enum
│   │   │   ├── ParagraphEmbed.vue      ← paragraph (inline sortable array)
│   │   │   └── ReferenceSelect.vue     ← reference (typeahead select)
│   │   ├── layout/                     ← shell chrome
│   │   │   ├── AppShell.vue            ← sidebar + topbar wrapper
│   │   │   ├── Sidebar.vue
│   │   │   └── Topbar.vue
│   │   └── shared/                     ← reusable UI pieces
│   │       ├── ConfirmDialog.vue
│   │       ├── Pagination.vue
│   │       ├── StatusBadge.vue
│   │       ├── ToastContainer.vue      ← renders ui store toast queue
│   │       └── MediaSelectModal.vue    ← shared media grid + select flow
│   │
│   ├── views/                          ← route-level page components
│   │   ├── LoginView.vue
│   │   ├── ChangePasswordView.vue      ← no sidebar chrome, must_change_password flow
│   │   ├── content/
│   │   │   ├── ContentListView.vue
│   │   │   ├── ContentFormView.vue     ← handles create, edit, and singleton modes
│   │   │   └── ContentSettingsView.vue ← base_path picker, admin/manager only
│   │   ├── taxonomy/
│   │   │   ├── TaxonomyListView.vue
│   │   │   └── TaxonomyFormView.vue
│   │   ├── media/
│   │   │   ├── MediaLibraryView.vue
│   │   │   └── MediaDetailView.vue
│   │   ├── users/
│   │   │   ├── UserListView.vue
│   │   │   └── UserFormView.vue
│   │   └── RolesView.vue
│   │
│   ├── composables/
│   │   ├── useApiClient.ts             ← typed fetch wrapper, 401 retry
│   │   ├── useFormValidation.ts        ← client + server error state
│   │   ├── useDirtyState.ts            ← unsaved changes tracking
│   │   ├── useNotification.ts          ← toast helper over ui store
│   │   └── usePermission.ts            ← can(), rolesBelow()
│   │
│   ├── stores/
│   │   ├── auth.ts                     ← current user, role, permissions
│   │   ├── schema.ts                   ← schema registry, roles list, hierarchyLevel
│   │   ├── content.ts                  ← content list/item state, page cache
│   │   ├── media.ts                    ← media library state
│   │   ├── taxonomy.ts                 ← taxonomy term state
│   │   ├── users.ts                    ← user management state
│   │   └── ui.ts                       ← toast queue, modal state, sidebar
│   │
│   ├── router/
│   │   └── index.ts                    ← vue-router setup, navigation guards
│   │
│   ├── types/
│   │   └── index.ts                    ← admin-local types, API response shapes
│   │
│   └── env.d.ts                        ← declare __ADMIN_PREFIX__, __API_PREFIX__
│
├── codegen/                            ← CLI-importable, no Vue dependency
│   ├── form-generator.ts               ← generateFormComponent() pure function
│   └── index.ts                        ← entry point for CLI import
│
├── __tests__/
│   └── views/
│       ├── login.test.ts
│       └── content-form.test.ts
│
├── index.html                          ← Vite SPA entry
├── vite.config.ts
├── tsup.config.ts                      ← codegen subpath only
└── package.json
```

---

## Two Build Tools

The admin package serves two distinct consumers:

| Consumer | Entry | Build tool |
|----------|-------|------------|
| Browser (SPA) | `src/main.ts` | Vite |
| CLI (`manguito build`) | `codegen/index.ts` | tsup |

Vite builds the SPA. tsup builds only the `codegen/` subpath — a pure TypeScript module with no Vue dependency.

---

## Subpath Export

`package.json` exposes two entry points:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./codegen": "./dist/codegen/index.js"
  }
}
```

The CLI imports cleanly:

```ts
import { generateFormComponent } from '@bobbykim/manguito-cms-admin/codegen'
```

The Vue SPA runtime never imports from `codegen/`. The two concerns are co-located but exposed through separate, explicit entry points.

---

## tsup Config (codegen only)

```ts
// tsup.config.ts
export default defineConfig({
  entry: ['codegen/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['vue'],
})
```

---

## TypeScript Declarations

Global constants injected by Vite `define` must be declared:

```ts
// src/env.d.ts
declare const __ADMIN_PREFIX__: string
declare const __API_PREFIX__: string
```

---

## Vite Define — Prefix Injection

The CLI reads `manguito.config.ts` and injects the configured prefixes into the Vite build config before running:

```ts
// injected by CLI into vite.config
define: {
  __ADMIN_PREFIX__: JSON.stringify(config.admin.prefix),  // e.g. '/admin'
  __API_PREFIX__: JSON.stringify(config.api.prefix),       // e.g. '/api'
}
```

Both prefixes are baked into the bundle at build time. No runtime bootstrap call needed for prefix resolution. This applies to both `manguito dev` and `manguito build`.
