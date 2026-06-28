# Admin

The browser-based management UI of Manguito CMS — a Vue 3 SPA that renders schema-driven forms, navigation, and lists, plus a Vue-free codegen module the CLI uses to emit static forms. It imports from core only and talks to the API over HTTP. See [docs/adr/admin](../../docs/adr/admin) for the decisions that shape it.

## Language

### Rendering

**Dynamic renderer**:
The dev-mode path that reads the parsed schema at runtime and picks a field component per `field_type` via `<component :is>`.
_Avoid_: runtime renderer, interpreter

**Generated form (SFC)**:
A static Vue single-file component emitted per schema type by `generateFormComponent` for production builds — the pre-rendered equivalent of the dynamic renderer.
_Avoid_: compiled form, template

**Field component**:
One of the nine Vue components (`TextInput`, `RichTextEditor`, …) that renders a single field, sharing the `FieldProps` interface and the `v-model` pattern.
_Avoid_: input, widget, control

**ParagraphEmbed**:
The field component that renders a sortable, collapsible inline array of paragraph instances, receiving the inner form as a `formComponent` prop.
_Avoid_: repeater, array field

### App shell and state

**Prefix constant**:
`__ADMIN_PREFIX__` / `__API_PREFIX__` — build-time Vite-injected globals every path is composed from. Never a hardcoded string.
_Avoid_: base URL, mount path

**Config bootstrap**:
The single `GET /admin/api/config` call on app load that verifies auth and populates the stores. Replaces a dedicated `auth/me` endpoint.
_Avoid_: session check, me call

**auth store**:
The Pinia store holding session truth — current user, role, derived permissions, hierarchy level. Cleared on logout.
_Avoid_: user store, session store

**schema store**:
The Pinia store holding system truth — the schema registry and the full roles list. Configured, not session-specific.
_Avoid_: config store, registry store

### Interaction

**Toast**:
A transient global notification for things the user should know but isn't blocked by (save success, non-form errors). Managed via `useNotification`.
_Avoid_: snackbar, alert, flash

**Inline error**:
A contextual error bound to a field or form action, owned by `useFormValidation` regardless of whether it came from client validation or the server.
_Avoid_: field error, validation message

**Hidden-not-disabled**:
The rule that permission-gated UI is removed (`v-if`), never shown disabled.
_Avoid_: greyed out, read-only gate

**Dirty state**:
Tracked unsaved-change status of a form, used to prompt before navigating away.
_Avoid_: pending changes, modified flag
