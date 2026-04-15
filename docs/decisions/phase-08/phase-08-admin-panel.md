# Decision — Admin Panel Design

> Deferred to Phase 8 (Admin panel). Captured here from Phase 2 discussions for future reference.

---

## Stack

| Concern | Library | Notes |
| ------- | ------- | ----- |
| Framework | Vue 3 (Composition API) | Already decided in Phase 1 |
| Build tool | Vite | Already decided in Phase 1 |
| Styling | Tailwind CSS | Already decided in Phase 1 |
| Components | shadcn-vue | Already decided in Phase 1 |
| State management | Pinia | Standard Vue 3 ecosystem |
| Routing | vue-router | Standard Vue 3 ecosystem |
| Rich text editor | `@tiptap/vue-3` | Justified — building WYSIWYG from scratch is complex and security-sensitive |
| Drag and drop | `@vueuse/core` (useSortable) | Justified — wraps Sortable.js, also provides many other useful composables |

---

## Schema Consumption — Build vs Dev

| Mode | How admin panel gets schema registry |
| ---- | ------------------------------------ |
| `manguito dev` | Runtime fetch from `/admin/api/schema` on startup |
| `manguito build` | Schema registry compiled into bundle at build time |

This mirrors the route generation strategy — dynamic in dev, static in production.

---

## Form Generation — Dynamic vs Static

| Mode | Form rendering approach |
| ---- | ----------------------- |
| `manguito dev` | Dynamic renderer reads `ParsedSchema` at runtime |
| `manguito build` | Static Vue components generated per content type |

Static components are generated *from* the dynamic renderer logic — they are the pre-rendered output of what the dynamic renderer would produce. This guarantees identical behavior in dev and production.

---

## Field Component Map

```
packages/admin/src/components/fields/
├── TextInput.vue          — text/plain
├── RichTextEditor.vue     — text/rich (Tiptap)
├── NumberInput.vue        — integer, float
├── BooleanToggle.vue      — boolean
├── DatePicker.vue         — date
├── MediaUpload.vue        — image, video, file (opens media modal)
├── EnumSelect.vue         — enum
├── ParagraphEmbed.vue     — paragraph (inline sortable form array)
└── ReferenceSelect.vue    — reference (typeahead select)
```

All field components share a standardized props interface:

```ts
interface FieldProps {
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean    // true when form is submitting
}
```

Vue `v-model` pattern (`modelValue` + `update:modelValue` emit) throughout.

---

## ParagraphEmbed Component

The most complex UI component. Renders an inline sortable form array for `paragraph` relation fields.

```
ParagraphEmbed
├── ParagraphInstanceList (sortable via @vueuse/core useSortable)
│   └── ParagraphInstance (collapsible)
│       ├── InstanceHeader
│       │   ├── DragHandle
│       │   ├── InstanceTitle (first text/plain value or "New [label]")
│       │   ├── ExpandCollapseToggle
│       │   └── DeleteButton (with confirmation)
│       └── InstanceForm (collapsed by default after save)
│           └── FieldRenderer per paragraph field
└── AddInstanceButton (hidden when max reached)
```

Instance state:

```ts
type ParagraphInstance = {
  id: string           // existing UUID or temp ID for new instances
  is_new: boolean
  is_dirty: boolean
  is_expanded: boolean
  data: Record<string, unknown>
  errors: Record<string, string>
}
```

UX behavior:
- New instances expand automatically
- Saved instances collapse by default
- Reorder via drag handle
- Delete shows inline confirmation (no modal)
- `AddInstanceButton` hidden when `max` limit reached

---

## Form Validation

**Timing:** Validate on blur (field loses focus). Submit re-validates all fields. No validation while typing.

**Publish vs draft:**
- Save as draft — skips `required` validation, allows incomplete content
- Publish — enforces all validation rules, blocks if any errors exist

**Validation composable:**

```ts
// composables/useFormValidation.ts
export function useFormValidation(schema: ParsedContentType) {
  const errors = ref<Record<string, string>>({})
  const touched = ref<Set<string>>(new Set())

  function validateField(fieldName: string, value: unknown): string | null { ... }
  function onBlur(fieldName: string, value: unknown): void { ... }
  function validateAll(data: Record<string, unknown>): boolean { ... }

  return { errors, touched, onBlur, validateAll }
}
```

---

## Dirty State and Unsaved Changes Warning

Uses `window.confirm` — intentionally simple, universally understood, no custom modal needed:

```ts
// composables/useDirtyState.ts
export function useDirtyState(initialData: Record<string, unknown>) {
  const savedData = ref(structuredClone(initialData))
  const currentData = ref(structuredClone(initialData))

  const isDirty = computed(() =>
    JSON.stringify(currentData.value) !== JSON.stringify(savedData.value)
  )

  function markSaved() {
    savedData.value = structuredClone(currentData.value)
  }

  function confirmNavigation(): boolean {
    if (!isDirty.value) return true
    return window.confirm('You have unsaved changes. Are you sure you want to leave?')
  }

  return { currentData, isDirty, markSaved, confirmNavigation }
}
```

Router guard calls `confirmNavigation()` before any navigation away from a dirty form.

---

## Pinia Store Organization

```
stores/
├── auth.ts       — current user, role, token state
├── schema.ts     — schema registry, loaded once on startup
├── content.ts    — generic content store (works for any content type)
├── media.ts      — media library state
├── taxonomy.ts   — taxonomy term state
├── users.ts      — user management (admin/manager only)
└── ui.ts         — modal state, sidebar, notifications
```

**Pagination strategy:** Server-driven pagination with Pinia as a page cache. Pages are fetched on demand and cached by `contentType:page:N:per_page:M` key. Cache is invalidated per content type on mutations. Memory stays bounded — only pages actually visited are held in memory.

Default page size: 50 items per page.

---

## Routing

```
/admin/login                           — public, no auth

/admin/content/:type                   — list view (only_one: false)
/admin/content/:type/new               — create form
/admin/content/:type/:id               — edit form
                                       — direct edit form if only_one: true

/admin/taxonomy/:type                  — list view
/admin/taxonomy/:type/new              — create form
/admin/taxonomy/:type/:id              — edit form

/admin/media                           — media library
/admin/media/:id                       — single media item (edit alt text)

/admin/users                           — user list (admin/manager only)
/admin/users/new                       — create user
/admin/users/:id                       — edit user

/admin/roles                           — role list, read-only
```

Routes are protected by navigation guards checking `auth.isAuthenticated` and route-level `meta.permission`.

Navigation is generated from the content type and taxonomy type lists fetched from:
```
GET /admin/api/content    — list available content types with counts
GET /admin/api/taxonomy   — list available taxonomy types
```

No hardcoded navigation — new schemas appear automatically.

---

## List View Default Columns

Smart default — no schema annotation needed:

| Column | Source |
| ------ | ------ |
| Title | First `text/plain` field in schema |
| Slug | System field (hidden for `only_one: true`) |
| Published | System field |
| Updated at | System field |

`only_one: true` content types skip the list view entirely — the route navigates directly to the edit form.

---

## Dev Server Integration

**Production — static file serving via Hono:**

```ts
app.use('/admin/*', serveStatic({ root: './dist/admin' }))
app.get('/admin/*', serveStatic({
  root: './dist/admin',
  rewriteRequestPath: () => '/index.html'  // SPA catch-all
}))
```

**Dev mode — Vite middleware mounted on Hono:**

```ts
const vite = await createViteServer({
  root: './packages/admin',
  server: { middlewareMode: true }
})

app.use('/admin/*', async (c, next) => {
  // Vite handles HMR, hot component reloading, Vue devtools
  // API routes take priority — Vite only intercepts non-API /admin/* requests
})
```

Route priority:
```
/api/*          → always Hono API handler
/admin/api/*    → always Hono API handler
/admin/*        → Vite (dev) or static files (prod)
```

---

## .manguito Generated Folder

`manguito dev` creates a `.manguito/` folder (gitignored) at startup — mirrors what Nuxt does with `.nuxt/`:

```
.manguito/
├── schema-registry.ts    — parsed schema registry
├── routes.ts             — Hono route registrations
├── forms/                — dynamic form definitions
│   ├── content--blog_post.ts
│   └── content--home_page.ts
└── nav.ts                — admin panel navigation
```

File watcher triggers incremental regeneration — only the changed schema's files are updated. Vite HMR picks up `.manguito/` changes automatically.

`manguito build` writes equivalent output to `dist/generated/` instead.
