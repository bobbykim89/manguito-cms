# Decision — Slug Handling

> Defines how slugs are created, validated, stored, and managed for content types.

---

## Scope

Slugs apply to content types only — not taxonomy types, not paragraph types.

| Schema type | Has slug |
|-------------|----------|
| `content-type` (`only_one: false`) | ✓ Per-item, user-provided |
| `content-type` (`only_one: true`) | Fixed — derived from content type name at route level |
| `taxonomy-type` | ✗ |
| `paragraph-type` | ✗ |

Slugs are runtime values stored in the DB — never defined in schema files.

---

## Creation

Slug is a **required manual input** on the content create form. The editor must provide it explicitly — there is no auto-generation.

**Rationale:** Auto-generation from a title field silently produces conflicts when two items have similar titles, forcing the editor to resolve it anyway. Making it explicit upfront is more honest and avoids invisible failures.

---

## Format Validation

The server enforces slug format on create and update. Valid slugs are:

- Lowercase only
- Alphanumeric characters and hyphens only
- No spaces, underscores, or special characters
- No leading or trailing hyphens

Examples:
```
my-blog-post      ✓ valid
My Blog Post      ✗ invalid — uppercase and spaces
my_blog_post      ✗ invalid — underscores
-my-post-         ✗ invalid — leading/trailing hyphens
```

Returns `422 INVALID_SLUG_FORMAT` with a descriptive message on invalid input.

---

## Uniqueness

Slugs must be unique within a content type. Two different content types can share a slug — uniqueness is scoped per type.

Returns `409 SLUG_CONFLICT` if a duplicate slug is attempted on create or update.

---

## Mutability

Slugs are **mutable** — an editor can update a slug at any time via `PATCH`.

```
PATCH /admin/api/blog-post/:id
Body: { slug: "my-new-slug" }
```

**Published content warning:** The admin panel displays a warning when an editor attempts to change the slug of a currently published item:

```
⚠ This content is published. Changing its slug will break any existing 
  links or bookmarks pointing to the current URL. Are you sure?
```

This is a UI-only warning — the server does not block the update. The editor makes an informed decision.

**Known limitation:** No automatic redirect is created when a slug changes. If a published item's slug is updated, the old URL returns `404`. Slug redirect management is deferred to v2.

---

## `findBySlug` Behavior

The `ContentRepository.findBySlug` method resolves a slug against the DB at request time. This allows content type renaming and versioning without redeployment:

```
content--blog_post_v2 can serve slug "my-post"
content--blog_post_v1 serves slug "my-post-deprecated" (unpublished)
```

The slug is decoupled from the schema machine name — the editor controls which slug each item holds.

---

## Parser Impact

No `slug_source` field is needed in schema files — slugs are manually provided. The parser does not need to validate a slug source field. The `slug` system field remains auto-injected as defined in Phase 2 with no changes.

---

## Error Codes

| Code | HTTP | Trigger |
|------|------|---------|
| `INVALID_SLUG_FORMAT` | 422 | Slug contains invalid characters |
| `SLUG_CONFLICT` | 409 | Slug already exists on another item of the same content type |
| `SLUG_NOT_FOUND` | 404 | `findBySlug` — no item with that slug exists |
