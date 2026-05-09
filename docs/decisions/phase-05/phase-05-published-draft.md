# Decision — Published/Draft State

> Defines how published state is stored, filtered, and toggled across the public and admin APIs.

---

## Column

`published` is an auto-injected system field on content types and taxonomy types. Already defined in Phase 2/3 — no schema changes needed.

```ts
// content type and taxonomy type system fields
{ name: "published", db_type: "boolean", default: "false", nullable: false }
```

Default is `false` — all new content starts as a draft.

---

## Public API Behavior (`/api/*`)

The public API **always** filters to published content only. This is hardcoded in the route handler — no query param can override it.

```ts
// public route handler — always published_only: true
const items = await repo.findMany({
  published_only: true,
  // ...other options
})
```

This applies to all content types and taxonomy types. Drafts are never visible to unauthenticated consumers under any circumstance.

---

## Admin API Behavior (`/admin/api/*`)

The admin API returns all content regardless of published state by default. Editors can filter by published status using an optional query param:

```
GET /admin/api/blog-post               → all items (draft + published)
GET /admin/api/blog-post?published=true  → published only
GET /admin/api/blog-post?published=false → drafts only
```

---

## Toggling Published State

`published` is a regular field in the `PATCH` payload — no dedicated publish/unpublish endpoints. The editor sets it via a checkbox or toggle switch in the content form.

```
PATCH /admin/api/blog-post/:id
Body: { published: true }   → publishes the item
Body: { published: false }  → unpublishes the item
```

---

## Server-Side Validation on Publish

When a `PATCH` request sets `published: true`, the server validates all required fields in the same request. If any required field is empty, the server returns `422 PUBLISH_VALIDATION_ERROR` with field-level details:

```json
{
  "ok": false,
  "error": {
    "code": "PUBLISH_VALIDATION_ERROR",
    "message": "Cannot publish — required fields are missing",
    "details": [
      { "field": "blog_meta_title", "message": "Meta Title is required" },
      { "field": "blog_cover", "message": "Cover Image is required" }
    ]
  }
}
```

The admin panel validates client-side first for a good UX, but the server enforces the same rules independently — any API client bypassing the admin panel receives the same validation response.

Setting `published: false` (unpublishing) skips required field validation — an editor should always be able to unpublish regardless of content state.

---

## Permission

`content:publish` is a distinct permission from `content:update`. A role can hold update rights without publish rights — for example, a contributor role that can write drafts but cannot go live without approval.

```ts
// admin content route — publish requires separate permission
app.patch('/admin/api/:type/:id', 
  requirePermission('content:update'),
  async (c) => {
    const body = await c.req.json()
    if (body.published === true) {
      // check additional publish permission
      requirePermission('content:publish')(c, next)
    }
    // ...
  }
)
```
