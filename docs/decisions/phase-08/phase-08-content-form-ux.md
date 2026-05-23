# Decision — Content Form UX

> Defines slug editing behavior, only_one singleton routing, ReferenceSelect typeahead, and dirty state handling.

---

## Slug Editing UX

Slugs apply to `only_one: false` content types only. Singletons have no slug field.

### On Create

- Slug field is required — form cannot submit without it
- **Live format helper**: as the editor types, the input automatically lowercases and replaces spaces/underscores with hyphens. Invalid characters (e.g. `%`, `@`) are rejected at the input level with a shake animation — not silently swallowed.
- This is ergonomic input assistance, not auto-generation. The editor still chooses their slug explicitly.
- Client-side validation fires on blur — feeds into `useFormValidation`
- `SLUG_CONFLICT` from server also feeds into `useFormValidation` as a field-level inline error

### On Edit — Unpublished

Same as create. No special behavior.

### On Edit — Published

Slug field renders read-only by default with an "Edit slug" button and a static inline warning beneath it:

```
Changing this slug will break existing links.
```

After clicking "Edit slug":
- Field becomes editable
- Warning remains visible

On save with a changed slug — a single confirmation dialog appears before the request fires:

```
This item is published. Changing its slug will break existing links. Continue?
```

This is a UI-only warning. The server does not block the update. Two-step friction (unlock → confirm on save) matches the established pattern of Contentful and similar platforms.

---

## `only_one: true` — Singleton Form

### Routing

`/admin/content/:type` navigates directly to the edit form — no list view, no `/new` route.

Sidebar nav item for singletons links directly to the form. Distinct icon from collection types (single document icon vs stack icon).

### Bootstrapping

The view calls `GET /admin/api/content/:type` on load:

- **Item exists** → edit mode, load item into form
- **Item does not exist** → empty form, first save calls `PUT` (create-or-replace semantics)

Subsequent saves also call `PUT`. The editor never sees a "create vs edit" distinction — it's always just "the form for this content type."

### Differences from Regular Content Form

`ContentFormView.vue` handles all three modes (create, edit, singleton) with conditionals:

| Feature | Regular | Singleton |
|---------|---------|-----------|
| Slug field | Shown | Hidden |
| Delete button | Shown | Hidden |
| HTTP method | POST (create) / PATCH (edit) | PUT always |
| List view | Yes | No |

No separate `SingletonFormView.vue` — the behavioral differences are small enough to handle with conditionals in one component.

---

## `only_one: true` — Settings Route

```
/admin/content/:type/settings
```

Accessible to `admin` and `manager` roles only. Provides a `base_path` picker — a select/typeahead populated from the available base paths defined in `routes.json`. The editor can switch which base path a content type uses without editing schema files.

This route exists for both `only_one: true` and `only_one: false` content types.

---

## `ReferenceSelect.vue` — Typeahead Behavior

Used for `reference` fields — selecting existing content items or taxonomy terms.

### Search

Debounced search on keystroke — 300ms delay. Minimum 2 characters before search fires.

```
GET /admin/api/content/:type?filters[{title_field}][like]={query}&per_page=10
```

`title_field` is the first `text/plain` field in the referenced schema — same smart default as list view columns.

For taxonomy references:
```
GET /admin/api/taxonomy/:type?filters[{title_field}][like]={query}&per_page=10
```

### UX States

| State | Display |
|-------|---------|
| Typing (< 2 chars) | No dropdown |
| Loading | Spinner in dropdown |
| Results | Up to 10 items |
| No results | "No results found for '[query]'" |

### Selection Display

- **`one-to-one`**: Selected item shown as a single chip with a clear (×) button
- **`one-to-many` / `many-to-many`**: Selected items shown as removable chips above the input

### Max Limit

For fields with a `max` value: input is disabled once the limit is reached. Counter shown: "X / Y selected."

---

## Dirty State and Media Modal

`useDirtyState` tracks changes to the form's `modelValue`. Opening and closing the media modal without confirming a selection does not affect dirty state — the form value hasn't changed. Confirming a media selection updates `modelValue`, which triggers dirty state naturally. No special modal handling needed.
